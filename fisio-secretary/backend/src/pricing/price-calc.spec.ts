import { computePriceQuote } from './price-calc';
import { PriceConfig } from '../common/entities/price-config.entity';

function cfg(overrides: Partial<PriceConfig> = {}): PriceConfig {
  return {
    id: 'c1',
    tenantId: 't1',
    isActive: true,
    products: [
      { key: 'ext57', label: 'Indiano Liso Extremo 57cm', price100g: 389.90 },
      { key: 'cach45', label: 'Cacheado 45cm', price100g: 379.90 },
      { key: 'bras65', label: 'Brasileiro Liso 65cm', price100g: 1399.90 },
    ],
    telaPerGram: 1,
    cartaoSurchargePer100g: 50,
    especieDiscountPer100g: 30,
    minGram: 50,
    gramStep: 50,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as PriceConfig;
}

describe('computePriceQuote', () => {
  it('100g à vista sem tela — replica os casos reais que a IA errou em produção', () => {
    const r = computePriceQuote(cfg(), { productKey: 'ext57', gramas: 100, tela: false, payment: 'vista' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.total).toBeCloseTo(389.90, 2);
  });

  it('150g à vista com tela — caso do lead 5252 (a IA respondeu R$1.124,85 certo, mas depois recalculou errado com base errada)', () => {
    const r = computePriceQuote(cfg(), { productKey: 'ext57', gramas: 150, tela: true, payment: 'vista' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.cabelo).toBeCloseTo(584.85, 2);
      expect(r.tela).toBeCloseTo(150, 2);
      expect(r.total).toBeCloseTo(734.85, 2);
      expect(r.text).toBe('R$734,85 à vista (R$584,85 do cabelo + R$150,00 da tela)');
    }
  });

  it('cacheado 45cm 100g na tela — caso real do lead 2964 (IA usou base de outro produto)', () => {
    const r = computePriceQuote(cfg(), { productKey: 'cach45', gramas: 100, tela: true, payment: 'vista' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.total).toBeCloseTo(479.90, 2);
  });

  it('50g é o mínimo — abaixo disso rejeita', () => {
    const r = computePriceQuote(cfg(), { productKey: 'ext57', gramas: 20, tela: false, payment: 'vista' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('gramatura_invalida');
  });

  it('gramatura fora do passo de 50 em 50 é rejeitada, não arredondada silenciosamente', () => {
    const r = computePriceQuote(cfg(), { productKey: 'ext57', gramas: 120, tela: false, payment: 'vista' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('gramatura_fora_do_passo');
  });

  it('produto fora do catálogo é rejeitado, nunca chuta um preço', () => {
    const r = computePriceQuote(cfg(), { productKey: 'nao_existe', gramas: 100, tela: false, payment: 'vista' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('produto_desconhecido');
  });

  it('cartão soma acréscimo por 100g proporcional à gramatura', () => {
    const r = computePriceQuote(cfg(), { productKey: 'ext57', gramas: 200, tela: false, payment: 'cartao' });
    expect(r.ok).toBe(true);
    // 389.90*2 + 50*2 = 879.80
    if (r.ok) expect(r.total).toBeCloseTo(879.80, 2);
  });

  it('cartão + tela combinados (200g) — cenário que a IA errou no stress test (esperado R$1.049,80, IA variava)', () => {
    const r = computePriceQuote(cfg(), { productKey: 'ext57', gramas: 200, tela: true, payment: 'cartao' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // cabelo: 389.90*2 + 50*2 = 879.80 ; tela: 200 ; total: 1079.80
      expect(r.cabelo).toBeCloseTo(879.80, 2);
      expect(r.tela).toBeCloseTo(200, 2);
      expect(r.total).toBeCloseTo(1079.80, 2);
    }
  });

  it('espécie subtrai desconto por 100g proporcional', () => {
    const r = computePriceQuote(cfg(), { productKey: 'ext57', gramas: 150, tela: true, payment: 'especie' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // cabelo: 389.90*1.5 - 30*1.5 = 584.85 - 45 = 539.85 ; tela 150 ; total 689.85
      expect(r.cabelo).toBeCloseTo(539.85, 2);
      expect(r.total).toBeCloseTo(689.85, 2);
    }
  });

  it('50g sem tela — gramatura mínima, produto caro (brasileiro)', () => {
    const r = computePriceQuote(cfg(), { productKey: 'bras65', gramas: 50, tela: false, payment: 'vista' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.total).toBeCloseTo(699.95, 2);
  });

  it('tela desabilitada no config (telaPerGram null) — pedir tela não soma nada, nunca quebra', () => {
    const r = computePriceQuote(cfg({ telaPerGram: null }), { productKey: 'ext57', gramas: 100, tela: true, payment: 'vista' });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.tela).toBe(0); expect(r.total).toBeCloseTo(389.90, 2); }
  });

  it('cartão desabilitado no config — pedir cartão não altera o valor do cabelo', () => {
    const r = computePriceQuote(cfg({ cartaoSurchargePer100g: null }), { productKey: 'ext57', gramas: 100, tela: false, payment: 'cartao' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.total).toBeCloseTo(389.90, 2);
  });

  it('400g (teto alto) mantém precisão de centavos sem drift de ponto flutuante', () => {
    const r = computePriceQuote(cfg(), { productKey: 'bras65', gramas: 400, tela: true, payment: 'cartao' });
    expect(r.ok).toBe(true);
    // cabelo: 1399.90*4 + 50*4 = 5599.60+200=5799.60 ; tela 400 ; total 6199.60
    if (r.ok) expect(r.total).toBeCloseTo(6199.60, 2);
  });

  it('gramStep=0 (venda livre, sem múltiplo obrigatório) aceita qualquer gramatura >= minGram', () => {
    const r = computePriceQuote(cfg({ gramStep: 0, minGram: 10 }), { productKey: 'ext57', gramas: 137, tela: false, payment: 'vista' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.total).toBeCloseTo(389.90 * 1.37, 2);
  });
});
