import { buildCatalogLines, hasAnyCaption, CAPTION_PRICE_RULE } from './media-catalog.util';

describe('media-catalog.util', () => {
  it('inclui a legenda (fonte de verdade do preço) junto do nome', () => {
    const out = buildCatalogLines([
      { name: 'Video-Indiano-Liso- Extremo- 57 cm', caption: '57 cm\nIndiano Liso Extremo\n389,90\n100 Gramas' },
    ]);
    expect(out).toContain('"Video-Indiano-Liso- Extremo- 57 cm"');
    // o preço da legenda TEM que chegar ao prompt — sem isso a IA não sabe
    // que esse produto custa 389,90 e empresta o preço de outra linha
    expect(out).toContain('389,90');
  });

  it('mantém o formato antigo quando a mídia não tem legenda', () => {
    const out = buildCatalogLines([{ name: 'Video- Cacheado- 45 cm', caption: null }]);
    expect(out).toBe('- "Video- Cacheado- 45 cm"');
  });

  it('hasAnyCaption gate: só liga a regra de preço quando existe legenda', () => {
    expect(hasAnyCaption([{ name: 'a', caption: null }, { name: 'b', caption: '  ' }])).toBe(false);
    expect(hasAnyCaption([{ name: 'a', caption: null }, { name: 'b', caption: '389,90' }])).toBe(true);
  });

  it('a regra proíbe emprestar preço entre produtos de nome parecido', () => {
    expect(CAPTION_PRICE_RULE).toContain('PROIBIDO usar o preço de um produto para outro produto');
    expect(CAPTION_PRICE_RULE).toContain('a LEGENDA VENCE');
  });

  it('achata legenda multilinha numa linha só (não quebra o bloco do prompt)', () => {
    const out = buildCatalogLines([{ name: 'x', caption: 'linha1\n  linha2\nlinha3' }]);
    expect(out.split('\n')).toHaveLength(2); // nome + 1 linha de legenda
    expect(out).toContain('linha1 | linha2 | linha3');
  });
});
