// Sugestão de qual serviço da Trinks corresponde a um serviço do salão, pelo nome.
// É só sugestão: quem liga de verdade é a cliente, ao aprovar na tela.

const STOPWORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'com', 'sem', 'no', 'na', 'o', 'a', 'para', 'um', 'uma', 'cabelo', 'cabelos']);
// Grupos de palavras que mudam o serviço — se um lado tem e o outro não, não é o mesmo.
const KIND_GROUPS: string[][] = [['remocao', 'retirada', 'retirar'], ['manutencao'], ['avaliacao'], ['confeccao']];

function conflicts(a: Set<string>, b: Set<string>): boolean {
  if ((a.has('sem') && b.has('com')) || (a.has('com') && b.has('sem'))) return true;
  return KIND_GROUPS.some((g) => g.some((w) => a.has(w)) !== g.some((w) => b.has(w)));
}

function words(name: string): string[] {
  return (name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function matchTokens(name: string): string[] {
  return words(name).filter((t) => !STOPWORDS.has(t));
}

export interface MatchCandidate {
  id: number;
  nome: string;
}

// Melhor candidato com nota (0–1). null = nada parecido o bastante.
export function suggestTrinksService<T extends MatchCandidate>(localName: string, candidates: T[]): { item: T; score: number } | null {
  const want = matchTokens(localName);
  if (!want.length) return null;
  const wantAll = new Set(words(localName));
  let best: { item: T; score: number; extra: number } | null = null;
  for (const c of candidates) {
    const have = matchTokens(c.nome);
    if (!have.length) continue;
    const haveAll = new Set(words(c.nome));
    // "progressiva sem formol" ≠ "progressiva com formol"; "remoção de fita" ≠ "fita adesiva".
    if (conflicts(wantAll, haveAll)) continue;
    // Números (telas, gramas) têm que bater.
    const nums = (ts: string[]) => ts.filter((t) => /^\d+$/.test(t)).join(',');
    if (nums(want) !== nums(have)) continue;
    const hit = want.filter((t) => have.some((h) => h === t || (t.length >= 5 && h.startsWith(t.slice(0, 5))))).length;
    const score = hit / Math.max(want.length, 1);
    const extra = have.length - hit;
    if (!best || score > best.score || (score === best.score && extra < best.extra)) best = { item: c, score, extra };
  }
  // Pelo menos 2/3 das palavras precisam bater — sugestão errada é pior que nenhuma.
  return best && best.score >= 0.66 ? { item: best.item, score: best.score } : null;
}
