import { suggestTrinksService } from './trinks-match';

// Trecho real do catálogo da Trinks da DALU (05/11/2026).
const trinks = [
  { id: 16006434, nome: 'Aplicação de fita adesiva ' },
  { id: 15355155, nome: 'Remoção fita' },
  { id: 9098918, nome: 'Manutencao de 1 tela' },
  { id: 9098925, nome: 'Manutencao de 2 telas' },
  { id: 9098932, nome: 'Manutencao de 3 telas' },
  { id: 9098933, nome: 'Manutencao de 4 telas' },
  { id: 9104473, nome: 'Progressiva com formol' },
  { id: 9104470, nome: 'Progressiva sem formol' },
  { id: 9128205, nome: 'Mechas completas' },
  { id: 12648293, nome: 'Corte' },
  { id: 12395981, nome: 'avaliação ' },
  { id: 9137617, nome: 'Avaliação de megahair' },
];

describe('suggestTrinksService', () => {
  it('liga nomes iguais com acento/caixa diferentes', () => {
    expect(suggestTrinksService('Manutenção de 2 telas', trinks)?.item.id).toBe(9098925);
    expect(suggestTrinksService('Mechas completas', trinks)?.item.id).toBe(9128205);
    expect(suggestTrinksService('Corte de cabelo', trinks)?.item.id).toBe(12648293);
  });

  it('número de telas precisa bater', () => {
    expect(suggestTrinksService('Manutenção de 4 telas', trinks)?.item.id).toBe(9098933);
  });

  it('não troca "sem formol" por "com formol"', () => {
    expect(suggestTrinksService('progressiva sem formol', trinks)?.item.id).toBe(9104470);
    expect(suggestTrinksService('progressiva com formol', trinks)?.item.id).toBe(9104473);
  });

  it('não liga remoção com aplicação', () => {
    expect(suggestTrinksService('Remoção de fita adesiva', trinks)?.item.id).toBe(15355155);
    expect(suggestTrinksService('Fita adesiva', trinks)?.item.id).not.toBe(15355155);
  });

  it('sem nada parecido, não sugere', () => {
    expect(suggestTrinksService('Coloração no megahair', trinks)).toBeNull();
    // metade das palavras não basta ("topo" ≠ "franja")
    expect(suggestTrinksService('Manutenção de topo', [{ id: 1, nome: 'manutenção de franja' }])).toBeNull();
  });
});
