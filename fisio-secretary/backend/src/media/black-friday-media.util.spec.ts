import { swapToBlackFriday, isBlackFridayMedia, hairSignature } from './black-friday-media.util';

// Nomes reais do catálogo da S&A Cabelos Naturais (11/11/2026).
const catalog = [
  'Video- Brasileiro- Liso- 75 cm',
  'Video- Cacheado iluminado- 65 cm- Black Friday- Promocao',
  'Video- Cacheado- 55 cm',
  'Video- Cacheado- 55 cm- Black Friday- Promocao',
  'Video- Cacheado- Iluminado- 75 cm',
  'Video- cacheado- iluminado- 75 cm- Black Friday- Promocao',
  'Video- Endereco- Loja',
  'Video- Indiano Premium- Liso- 65 cm- Black Friday- Promocao',
  'Video- Indiano- Premium- Liso- 65 cm',
  'Video- Indiano- Premium- Liso- 58 cm',
  'Video- indiano- Liso- 59 cm- Black Friday- Promocao',
  'Video- Indiano- Liso- 59 cm- promoção',
  'Video- Indiano- promocao- Ondulado- 75 cm',
  'Video- indiano- ondulado- 75 cm- Black Friday- Promocao',
  'Video- Morena iluminado- 65 cm',
  'Video- Morena iluminado- 65 cm- Black Friday- Promocao',
  'Video- Vietnamita- Liso- 59 cm- Black Friday- Promocao',
  'Video- Vietnamita- Liso- 64 cm',
  'Video- Vietnamita- promocao- liso- 59 cm',
  'Video- Vietnamita- promocao- liso- 68 cm',
  'Video- Vietnamita- Liso- 68 cm- Black Friday- Promocao',
  'Video-Indiano-promocao-ondulado-65 cm',
  'Video- indiano- ondulado- 65 cm- Black Friday- Promocao',
];

describe('swapToBlackFriday', () => {
  it('troca o vídeo antigo pela versão Black Friday do mesmo cabelo (caso Bianca)', () => {
    const r = swapToBlackFriday(['Video- Vietnamita- promocao- liso- 59 cm'], catalog);
    expect(r.names).toEqual(['Video- Vietnamita- Liso- 59 cm- Black Friday- Promocao']);
    expect(r.blocked).toEqual([]);
  });

  it('acha a versão Black Friday com caixa, acento e hífen diferentes', () => {
    expect(swapToBlackFriday(['Video- Indiano- Liso- 59 cm- promoção'], catalog).names).toEqual(['Video- indiano- Liso- 59 cm- Black Friday- Promocao']);
    expect(swapToBlackFriday(['Video-Indiano-promocao-ondulado-65 cm'], catalog).names).toEqual(['Video- indiano- ondulado- 65 cm- Black Friday- Promocao']);
    expect(swapToBlackFriday(['Video- Cacheado- Iluminado- 75 cm'], catalog).names).toEqual(['Video- cacheado- iluminado- 75 cm- Black Friday- Promocao']);
    expect(swapToBlackFriday(['Video- Indiano- Premium- Liso- 65 cm'], catalog).names).toEqual(['Video- Indiano Premium- Liso- 65 cm- Black Friday- Promocao']);
  });

  it('não troca por tamanho ou linha diferente', () => {
    // Cacheado 55 ≠ Cacheado iluminado; Premium 58 não tem Black Friday
    expect(swapToBlackFriday(['Video- Cacheado- 55 cm'], catalog).names).toEqual(['Video- Cacheado- 55 cm- Black Friday- Promocao']);
    const premium58 = swapToBlackFriday(['Video- Indiano- Premium- Liso- 58 cm'], catalog);
    expect(premium58.names).toEqual([]);
    expect(premium58.blocked).toEqual(['Video- Indiano- Premium- Liso- 58 cm']);
  });

  it('barra vídeo de cabelo sem versão Black Friday', () => {
    const r = swapToBlackFriday(['Video- Brasileiro- Liso- 75 cm', 'Video- Vietnamita- Liso- 64 cm'], catalog);
    expect(r.names).toEqual([]);
    expect(r.blocked).toHaveLength(2);
  });

  it('mantém vídeo Black Friday e vídeo que não é de cabelo', () => {
    const names = ['Video- Morena iluminado- 65 cm- Black Friday- Promocao', 'Video- Endereco- Loja'];
    expect(swapToBlackFriday(names, catalog)).toEqual({ names, swapped: [], blocked: [] });
  });

  it('não duplica quando a IA manda o antigo e o novo juntos', () => {
    const r = swapToBlackFriday(['Video- Vietnamita- promocao- liso- 68 cm', 'Video- Vietnamita- Liso- 68 cm- Black Friday- Promocao'], catalog);
    expect(r.names).toEqual(['Video- Vietnamita- Liso- 68 cm- Black Friday- Promocao']);
  });

  it('helpers', () => {
    expect(isBlackFridayMedia('Video- Loiro- Liso- 55 cm- Black Friday- Promocao')).toBe(true);
    expect(isBlackFridayMedia('Video- Vietnamita- promocao- liso- 59 cm')).toBe(false);
    expect(hairSignature('Video- Vietnamita- promocao- liso- 59 cm')).toBe(hairSignature('Video- Vietnamita- Liso- 59 cm- Black Friday- Promocao'));
  });
});
