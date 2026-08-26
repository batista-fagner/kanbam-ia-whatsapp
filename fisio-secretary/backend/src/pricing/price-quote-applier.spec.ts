import { applyPriceQuotes } from './price-quote-applier';
import { PriceConfig } from '../common/entities/price-config.entity';

function cfg(): PriceConfig {
  return {
    id: 'c1', tenantId: 't1', isActive: true,
    products: [{ key: 'ext57', label: 'Indiano Liso Extremo 57cm', price100g: 389.90 }],
    telaPerGram: 1, cartaoSurchargePer100g: 50, especieDiscountPer100g: 30,
    minGram: 50, gramStep: 50, createdAt: new Date(), updatedAt: new Date(),
  } as PriceConfig;
}

describe('applyPriceQuotes', () => {
  it('substitui o placeholder pelo valor calculado', () => {
    const out = applyPriceQuotes(
      'À vista, 150g fica [[PRECO:a]]. Confirma com a profissional a quantidade, tá?',
      [{ id: 'a', productKey: 'ext57', gramas: 150, tela: true, payment: 'vista' }],
      cfg(),
    );
    expect(out).toBe('À vista, 150g fica R$734,85 à vista (R$584,85 do cabelo + R$150,00 da tela). Confirma com a profissional a quantidade, tá?');
  });

  it('substitui múltiplos placeholders na mesma resposta', () => {
    const out = applyPriceQuotes(
      'De 100g fica [[PRECO:a]], de 200g fica [[PRECO:b]].',
      [
        { id: 'a', productKey: 'ext57', gramas: 100, tela: false, payment: 'vista' },
        { id: 'b', productKey: 'ext57', gramas: 200, tela: false, payment: 'vista' },
      ],
      cfg(),
    );
    expect(out).toBe('De 100g fica R$389,90 à vista, de 200g fica R$779,80 à vista.');
  });

  it('sem quotes ou sem config, devolve o reply intacto', () => {
    expect(applyPriceQuotes('oi', undefined, cfg())).toBe('oi');
    expect(applyPriceQuotes('oi [[PRECO:a]]', [{ id: 'a', productKey: 'ext57', gramas: 100, tela: false, payment: 'vista' }], null)).toBe('oi [[PRECO:a]]');
  });

  it('cotação inválida remove o placeholder em vez de vazar ou inventar valor', () => {
    const out = applyPriceQuotes(
      'Fica [[PRECO:a]] pra você.',
      [{ id: 'a', productKey: 'produto_que_nao_existe', gramas: 100, tela: false, payment: 'vista' }],
      cfg(),
    );
    expect(out).not.toContain('[[PRECO');
    expect(out).toBe('Fica pra você.');
  });
});
