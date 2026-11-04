import { findSimilarMedia, mediaNameTokens } from './media-similar-match.util';

const catalog = [
  { name: 'CABELO PERUANO LISO ONDULADO 60/65 CM' },
  { name: 'CABELO VIETNAMITA LISO ONDULADO 60/65 CM' },
  { name: 'CABELO VIETNAMITA LISO ONDULADO 50/55 CM' },
  { name: 'CABELO VIETNAMITA LISO 70 CM' },
];

describe('findSimilarMedia', () => {
  it('"VIETNAMITA ONDULADO" casa com o vietnamita liso ondulado (caso do Paraíso Dos Fios)', () => {
    const r = findSimilarMedia('VIETNAMITA ONDULADO', catalog);
    expect(r?.item.name).toBe('CABELO VIETNAMITA LISO ONDULADO 50/55 CM');
    expect(r?.ambiguous).toBe(true);
  });

  it('com tamanho no pedido, escolhe a mídia certa e não é ambíguo', () => {
    const r = findSimilarMedia('vietnamita ondulado 60cm', catalog);
    expect(r?.item.name).toBe('CABELO VIETNAMITA LISO ONDULADO 60/65 CM');
    expect(r?.ambiguous).toBe(false);
  });

  it('não confunde o peruano com o vietnamita', () => {
    const r = findSimilarMedia('PERUANO ONDULADO', catalog);
    expect(r?.item.name).toBe('CABELO PERUANO LISO ONDULADO 60/65 CM');
  });

  it('uma palavra só é vaga demais: não adivinha', () => {
    expect(findSimilarMedia('VIETNAMITA', catalog)).toBeNull();
    expect(findSimilarMedia('CABELO', catalog)).toBeNull();
  });

  it('sem candidata com todas as palavras, devolve null', () => {
    expect(findSimilarMedia('BRASILEIRO CACHEADO', catalog)).toBeNull();
    expect(findSimilarMedia('VIETNAMITA ONDULADO 90CM', catalog)).toBeNull();
  });

  it('ignora acento e separa letra de número', () => {
    expect(mediaNameTokens('Vídeo CACHEADO 60cm')).toEqual(['cacheado', '60']);
  });
});
