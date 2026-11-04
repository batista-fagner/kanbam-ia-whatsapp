// Aproximação de nome de mídia: a IA às vezes encurta o nome do catálogo
// ("VIETNAMITA ONDULADO" em vez de "CABELO VIETNAMITA LISO ONDULADO 50/55 CM").
// Só é usada DEPOIS que o match exato, o de caixa e o sem pontuação falharam —
// nunca altera um match que já funciona.

// Liberado só para estes clientes por enquanto (piloto: Paraíso Dos Fios, 04/11/2026).
export const SIMILAR_MEDIA_TENANT_IDS = new Set<string>(['46318606-4be1-4791-b063-3b99f7b30e6a']);

// Palavras que não ajudam a distinguir uma mídia da outra.
const STOPWORDS = new Set(['cabelo', 'cabelos', 'video', 'videos', 'de', 'da', 'do', 'das', 'dos', 'e', 'cm', 'com', 'para']);

export function mediaNameTokens(name: string): string[] {
  const clean = (name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    // separa letra de número: "60cm" → "60 cm"
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2');
  return clean.split(/[^a-z0-9]+/).filter((t) => t && !STOPWORDS.has(t));
}

export interface SimilarMatch<T> {
  item: T;
  ambiguous: boolean; // true quando mais de uma mídia servia
}

/**
 * Acha a mídia cujo nome contém TODAS as palavras relevantes do nome pedido.
 * - exige ao menos 2 palavras relevantes (evita "VIETNAMITA" casar com tudo);
 * - havendo mais de uma candidata, escolhe a de nome mais enxuto (menos palavras
 *   a mais) e, no empate, a primeira em ordem alfabética — resultado estável.
 */
export function findSimilarMedia<T extends { name: string }>(
  requested: string,
  candidates: T[],
): SimilarMatch<T> | null {
  const wanted = mediaNameTokens(requested);
  if (wanted.length < 2) return null;

  const matches = candidates
    .map((item) => ({ item, tokens: mediaNameTokens(item.name) }))
    .filter(({ tokens }) => wanted.every((w) => tokens.includes(w)));
  if (matches.length === 0) return null;

  matches.sort(
    (a, b) =>
      a.tokens.length - b.tokens.length ||
      a.item.name.localeCompare(b.item.name, 'pt-BR', { numeric: true }),
  );
  return { item: matches[0].item, ambiguous: matches.length > 1 };
}
