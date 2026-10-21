import { computeSizeQuote, buildPriceCatalogBlock, hasPriceTable } from './price-calc';
import { applyPriceQuotes } from './price-quote-applier';
import { PriceConfig } from '../common/entities/price-config.entity';

// Tabela por tamanho — piloto Studio Simone Trindade (valores reais dela).
function cfg(overrides: Partial<PriceConfig> = {}): PriceConfig {
  return {
    id: 'c1',
    tenantId: 't1',
    isActive: true,
    products: [],
    sizeProducts: [
      { key: 'indiano_premium', label: 'Indiano Premium Liso/Ondulado', sizes: [
        { cm: 45, price: 450, cardPrice: null }, { cm: 55, price: 550, cardPrice: null }, { cm: 65, price: 650, cardPrice: null }, { cm: 75, price: 690, cardPrice: null },
      ] },
      { key: 'cacho_viet_castanho', label: 'Cacho Vietnamita Castanho Escuro', sizes: [
        { cm: 60, price: 750, cardPrice: 825 }, { cm: 65, price: 750, cardPrice: 825 },
      ] },
    ],
    telaPerGram: null,
    cartaoSurchargePer100g: null,
    especieDiscountPer100g: null,
    minGram: 50,
    gramStep: 50,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as PriceConfig;
}

describe('computeSizeQuote', () => {
  it('lê o valor à vista do tamanho', () => {
    const r = computeSizeQuote(cfg(), { productKey: 'indiano_premium', cm: 65, payment: 'vista' });
    expect(r).toMatchObject({ ok: true, total: 650, text: 'R$650,00 à vista' });
  });

  it('cartão com valor próprio usa o valor de cartão', () => {
    const r = computeSizeQuote(cfg(), { productKey: 'cacho_viet_castanho', cm: 60, payment: 'cartao' });
    expect(r).toMatchObject({ ok: true, total: 825, text: 'R$825,00 no cartão' });
  });

  it('cartão sem valor cadastrado devolve o à vista avisando do acréscimo (nunca inventa)', () => {
    const r = computeSizeQuote(cfg(), { productKey: 'indiano_premium', cm: 55, payment: 'cartao' });
    expect(r).toMatchObject({ ok: true, total: 550, text: 'R$550,00 à vista (no cartão tem acréscimo)' });
  });

  it('tamanho fora da tabela não vira preço — devolve os tamanhos que existem', () => {
    const r = computeSizeQuote(cfg(), { productKey: 'indiano_premium', cm: 60, payment: 'vista' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('tamanho_indisponivel');
      expect(r.text).toContain('45, 55, 65 e 75cm');
    }
  });

  it('produto desconhecido', () => {
    expect(computeSizeQuote(cfg(), { productKey: 'xx', cm: 65, payment: 'vista' }).ok).toBe(false);
  });
});

describe('applyPriceQuotes com tabela por tamanho', () => {
  it('troca vários placeholders (vista + cartão)', () => {
    const out = applyPriceQuotes('O de 60cm fica [[PRECO:a]] ou [[PRECO:b]] 😊', [
      { id: 'a', productKey: 'cacho_viet_castanho', cm: 60, payment: 'vista' },
      { id: 'b', productKey: 'cacho_viet_castanho', cm: 60, payment: 'cartao' },
    ], cfg());
    expect(out).toBe('O de 60cm fica R$750,00 à vista ou R$825,00 no cartão 😊');
  });

  it('não duplica "à vista" quando a IA repete depois do placeholder', () => {
    const out = applyPriceQuotes('O de 55cm fica [[PRECO:a]] à vista.', [{ id: 'a', productKey: 'indiano_premium', cm: 55, payment: 'vista' }], cfg());
    expect(out).toBe('O de 55cm fica R$550,00 à vista.');
  });

  it('tamanho fora da tabela troca a frase inteira (caso real do teste: cacho indiano 60cm)', () => {
    const out = applyPriceQuotes('O Indiano de 60cm é show, Bruna! Ele fica [[PRECO:a]] à vista. 😊 Quantos gramas você usa?',
      [{ id: 'a', productKey: 'indiano_premium', cm: 60, payment: 'vista' }], cfg());
    expect(out).toBe('O Indiano de 60cm é show, Bruna! Esse tamanho não temos nessa linha — temos 45, 55, 65 e 75cm. Qual você prefere? 😊 Quantos gramas você usa?');
  });

  it('placeholder sem cotação nunca chega na cliente', () => {
    expect(applyPriceQuotes('Fica [[PRECO:a]] linda', undefined, cfg())).toBe('Fica linda');
  });

  it('sem config, reply intocado', () => {
    expect(applyPriceQuotes('Fica R$650', undefined, null)).toBe('Fica R$650');
  });
});

describe('bloco do prompt por tamanho', () => {
  it('lista os tamanhos mas nunca os valores', () => {
    const block = buildPriceCatalogBlock(cfg());
    expect(block).toContain('key: "indiano_premium"');
    expect(block).toContain('45, 55, 65 e 75cm');
    expect(block).toContain('tem valor próprio no cartão');
    expect(block).not.toMatch(/650|825|R\$ ?\d/);
  });

  it('tabela só por grama continua com o bloco de antes (S&A intocado)', () => {
    const gram = cfg({ sizeProducts: [], products: [{ key: 'ext57', label: 'Indiano 57cm', price100g: 389.9 }], telaPerGram: 1 });
    const block = buildPriceCatalogBlock(gram);
    expect(block).toContain('TABELA DE PREÇOS (cálculo automático');
    expect(block).not.toContain('POR TAMANHO');
  });

  it('hasPriceTable: desligada ou vazia não entra', () => {
    expect(hasPriceTable(cfg())).toBe(true);
    expect(hasPriceTable(cfg({ isActive: false }))).toBe(false);
    expect(hasPriceTable(cfg({ sizeProducts: [] }))).toBe(false);
    expect(hasPriceTable(null)).toBe(false);
  });
});
