import { BadRequestException } from '@nestjs/common';
import { PriceConfigService } from './price-config.service';

// Salvar tabela por tamanho (tela "Tabela de preços" → Por tamanho).
describe('PriceConfigService — produtos por tamanho', () => {
  let stored: any;
  let svc: PriceConfigService;

  beforeEach(() => {
    stored = {
      tenantId: 't1', isActive: false, minGram: 50, gramStep: 50, telaPerGram: null, cartaoSurchargePer100g: null, especieDiscountPer100g: null,
      products: [], sizeProducts: [{ key: 'indiano', label: 'Indiano', sizes: [{ cm: 55, price: 550, cardPrice: null }] }],
    };
    const repo: any = {
      findOne: jest.fn(async () => stored),
      create: jest.fn((x) => ({ ...x })),
      save: jest.fn(async (x) => x),
    };
    svc = new PriceConfigService(repo);
  });

  it('normaliza valores, ordena tamanhos e mantém a key existente', async () => {
    const r: any = await svc.save('t1', { sizeProducts: [
      { key: 'indiano', label: 'Indiano Premium', sizes: [{ cm: '65', price: '650', cardPrice: '' }, { cm: 45, price: 450.5, cardPrice: 500 }] },
      { label: 'Cacho Vietnamita', sizes: [{ cm: 60, price: 750, cardPrice: 825 }] },
    ] });
    expect(r.sizeProducts).toEqual([
      { key: 'indiano', label: 'Indiano Premium', refGrams: 100, sizes: [{ cm: 45, price: 450.5, cardPrice: 500 }, { cm: 65, price: 650, cardPrice: null }] },
      { key: 'cacho_vietnamita', label: 'Cacho Vietnamita', refGrams: 100, sizes: [{ cm: 60, price: 750, cardPrice: 825 }] },
    ]);
  });

  it('guarda a referência de gramas do cabelo (padrão 100) e recusa valores absurdos', async () => {
    const r: any = await svc.save('t1', { sizeProducts: [
      { label: 'A', refGrams: '50', sizes: [{ cm: 55, price: 100 }] },
      { label: 'B', sizes: [{ cm: 55, price: 100 }] },
    ] });
    expect(r.sizeProducts.map((p: any) => p.refGrams)).toEqual([50, 100]);
    await expect(svc.save('t1', { sizeProducts: [{ label: 'C', refGrams: 0, sizes: [{ cm: 55, price: 1 }] }] })).rejects.toThrow('gramas de referência');
    await expect(svc.save('t1', { sizeProducts: [{ label: 'C', refGrams: 99999, sizes: [{ cm: 55, price: 1 }] }] })).rejects.toThrow('gramas de referência');
  });

  it('recusa tamanho repetido, sem preço ou sem tamanhos', async () => {
    await expect(svc.save('t1', { sizeProducts: [{ label: 'A', sizes: [{ cm: 55, price: 1 }, { cm: 55, price: 2 }] }] })).rejects.toThrow(BadRequestException);
    await expect(svc.save('t1', { sizeProducts: [{ label: 'A', sizes: [{ cm: 55, price: '' }] }] })).rejects.toThrow('preço obrigatório');
    await expect(svc.save('t1', { sizeProducts: [{ label: 'A', sizes: [] }] })).rejects.toThrow('pelo menos um tamanho');
  });

  it('admin liga a tabela só com produtos por tamanho (sem produto por grama)', async () => {
    const r: any = await svc.save('t1', { isActive: true }, { canToggle: true });
    expect(r.isActive).toBe(true);
  });

  it('key de produto por tamanho nunca colide com a de produto por grama', async () => {
    stored.products = [{ key: 'indiano_2', label: 'Indiano 2', price100g: 100 }];
    const r: any = await svc.save('t1', { sizeProducts: [{ label: 'Indiano 2', sizes: [{ cm: 55, price: 550 }] }] });
    expect(r.sizeProducts[0].key).not.toBe('indiano_2');
  });
});
