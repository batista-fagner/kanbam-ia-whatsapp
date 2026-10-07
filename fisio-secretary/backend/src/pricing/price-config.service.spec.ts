import { BadRequestException } from '@nestjs/common';
import { PriceConfigService } from './price-config.service';

describe('PriceConfigService', () => {
  let repo: any;
  let svc: PriceConfigService;
  let stored: any;

  beforeEach(() => {
    stored = {
      tenantId: 't1', isActive: true, minGram: 50, gramStep: 50,
      telaPerGram: '1.00', cartaoSurchargePer100g: '50.00', especieDiscountPer100g: null,
      products: [
        { key: 'liso_castanho', label: 'Liso castanho', price100g: 389.9 },
        { key: 'ondulado', label: 'Ondulado', price100g: 450 },
      ],
    };
    repo = {
      findOne: jest.fn(async ({ where }) => (where.tenantId === 't1' ? stored : null)),
      create: jest.fn((x) => ({ ...x })),
      save: jest.fn(async (x) => x),
    };
    svc = new PriceConfigService(repo);
  });

  it('busca sempre pelo tenant do token', async () => {
    expect(await svc.get('outro')).toEqual({ exists: false });
    const r: any = await svc.get('t1');
    expect(r.exists).toBe(true);
    expect(r.telaPerGram).toBe(1);
    expect(r.especieDiscountPer100g).toBeNull();
  });

  it('mantém a key de produto existente mesmo com nome editado e gera key pra produto novo', async () => {
    const r: any = await svc.save('t1', {
      products: [
        { key: 'liso_castanho', label: 'Liso castanho escuro', price100g: '399,90' },
        { label: 'Ondulado', price100g: 480 },
        { label: 'Loiro platinado', price100g: 600 },
      ],
    });
    expect(r.products).toEqual([
      { key: 'liso_castanho', label: 'Liso castanho escuro', price100g: 399.9 },
      { key: 'ondulado_2', label: 'Ondulado', price100g: 480 },
      { key: 'loiro_platinado', label: 'Loiro platinado', price100g: 600 },
    ]);
  });

  it('ignora key forjada que não existe na tabela', async () => {
    const r: any = await svc.save('t1', { products: [{ key: 'inventada', label: 'X', price100g: 10 }] });
    expect(r.products[0].key).toBe('x');
  });

  it('recusa preço inválido, nome vazio e nome repetido', async () => {
    await expect(svc.save('t1', { products: [{ label: 'A', price100g: 0 }] })).rejects.toThrow(BadRequestException);
    await expect(svc.save('t1', { products: [{ label: ' ', price100g: 10 }] })).rejects.toThrow(BadRequestException);
    await expect(svc.save('t1', { products: [{ label: 'A', price100g: 10 }, { label: 'a', price100g: 20 }] })).rejects.toThrow(/repetido/);
  });

  it('campo de acréscimo vazio vira null (forma de cobrança não existe)', async () => {
    const r: any = await svc.save('t1', { cartaoSurchargePer100g: '' });
    expect(r.cartaoSurchargePer100g).toBeNull();
  });

  it('não liga tabela sem produtos', async () => {
    await expect(svc.save('novo', { isActive: true, products: [] }, { canToggle: true })).rejects.toThrow(/pelo menos um produto/);
  });

  it('cliente não consegue desligar o cálculo automático; admin consegue', async () => {
    const r1: any = await svc.save('t1', { isActive: false });
    expect(r1.isActive).toBe(true);
    const r2: any = await svc.save('t1', { isActive: false }, { canToggle: true });
    expect(r2.isActive).toBe(false);
  });

  it('salvar sem mudar nada preserva os produtos e valores exatos', async () => {
    const original = JSON.parse(JSON.stringify(stored.products));
    const cur: any = await svc.get('t1');
    const r: any = await svc.save('t1', {
      products: cur.products, telaPerGram: cur.telaPerGram, cartaoSurchargePer100g: cur.cartaoSurchargePer100g,
      especieDiscountPer100g: cur.especieDiscountPer100g, minGram: cur.minGram, gramStep: cur.gramStep,
    });
    expect(r.products).toEqual(original);
    expect([r.telaPerGram, r.cartaoSurchargePer100g, r.especieDiscountPer100g, r.isActive]).toEqual([1, 50, null, true]);
  });
});
