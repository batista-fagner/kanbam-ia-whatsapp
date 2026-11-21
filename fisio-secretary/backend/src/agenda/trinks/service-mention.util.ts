// Trava anti-troca de serviço (agenda Trinks).
//
// 20/11/2026 (DALU): a cliente pediu "avaliação", que ainda não estava aprovada pra IA. Em vez de
// dizer "a equipe confirma", a IA escolheu "Corte de cabelo" por conta própria, e ainda tratou o
// "Sim! A avaliação" da cliente como confirmação do corte. Aqui ficam as peças puras que
// comparam o que a CLIENTE escreveu com o serviço que a IA quer gravar.

export interface NamedService {
  id: string;
  name: string;
}

const STOP = new Set(['de', 'do', 'da', 'dos', 'das', 'em', 'com', 'sem', 'para', 'por', 'no', 'na', 'e', 'a', 'o', 'um', 'uma', 'cabelo', 'cabelos']);

export function norm(s: string | null | undefined): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

// Palavras que identificam o serviço ("Corte de cabelo" → corte; "Manutenção de 2 telas" → manutencao, 2, telas).
export function distinctiveTokens(serviceName: string): string[] {
  return norm(serviceName)
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !STOP.has(t) && (t.length >= 3 || /^\d+$/.test(t)));
}

// "avaliacao" → "avalia" (pega avaliar/avaliação); "telas" → "tela"; palavras curtas, exatas.
function stem(token: string): string {
  if (token.length >= 8) return token.slice(0, 6);
  if (token.length >= 5) return token.slice(0, token.length - 1);
  return token;
}

function hasToken(normText: string, token: string): boolean {
  // Número solto ("2 telas") só vale inteiro: o "2" não pode casar com "21/11".
  const tail = /^\d+$/.test(token) ? '(?![a-z0-9])' : '';
  return new RegExp(`(?:^|[^a-z0-9])${stem(token)}${tail}`).test(normText);
}

// Pelo menos UMA palavra do serviço aparece no texto (leve: serve pra "ela falou do serviço?").
export function mentionsAny(text: string, serviceName: string): boolean {
  const n = norm(text);
  const tokens = distinctiveTokens(serviceName);
  return tokens.length > 0 && tokens.some((t) => hasToken(n, t));
}

// TODAS as palavras do serviço aparecem (estrito: serve pra "ela pediu ESTE serviço").
export function mentionsAll(text: string, serviceName: string): boolean {
  const n = norm(text);
  const tokens = distinctiveTokens(serviceName);
  return tokens.length > 0 && tokens.every((t) => hasToken(n, t));
}

export type ServiceConflict = { kind: 'unapproved' | 'other'; service: NamedService } | null;

// textsNewestFirst: o que a cliente escreveu, da mensagem mais nova para a mais antiga.
// Olha só a mensagem mais recente em que ela NOMEIA algum serviço:
// - se ela nomeou o serviço escolhido pela IA → sem conflito;
// - se nomeou um serviço NÃO liberado pra IA (ex.: avaliação) → conflito 'unapproved';
// - se nomeou outro serviço liberado → conflito 'other', mas só quando `confirming` (na hora do
//   "sim") e a mensagem está entre as últimas `recentWindow`.
export function findServiceConflict(
  textsNewestFirst: string[],
  chosen: NamedService,
  allServices: NamedService[],
  approvedIds: Set<string>,
  opts: { confirming: boolean; recentWindow?: number } = { confirming: false },
): ServiceConflict {
  const window = opts.recentWindow ?? 3;
  for (let i = 0; i < textsNewestFirst.length; i++) {
    const text = textsNewestFirst[i];
    const named = allServices.filter((s) => mentionsAll(text, s.name));
    if (!named.length) continue;
    if (mentionsAny(text, chosen.name)) return null;
    const unapproved = named.find((s) => !approvedIds.has(s.id));
    if (unapproved) return { kind: 'unapproved', service: unapproved };
    if (opts.confirming && i < window) return { kind: 'other', service: named[0] };
    return null;
  }
  return null;
}
