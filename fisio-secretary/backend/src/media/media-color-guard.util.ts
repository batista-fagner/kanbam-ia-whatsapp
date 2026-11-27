// Trava de cor no envio de foto/vídeo de cabelo.
//
// Bug real (DALU, 27/11/2026, lead 558499806104): a cliente tem base escura e nunca disse
// que queria loiro, mas a IA perguntou "quer ver cabelos que combinam com o seu tom?" e
// mandou 3 mídias de cabelo loiro. O prompt manda perguntar a cor antes, e o modelo pula.
// Regra do Fagner: nada de foto de cabelo antes de saber a cor que a cliente quer.
//
// - Mídia de TÉCNICA (fita, queratina, tela, microlink...) passa sempre: mostra o método, não a cor.
// - Mídia de CABELO só sai depois que a cliente falou alguma cor/tom em alguma mensagem.
// - Mídia de cabelo LOIRO (ou iluminado/mechas) só sai se ela falou em loiro/clarear/mechas.
// - Mídia de cabelo CASTANHO só sai se ela falou em castanho/escuro/moreno/preto/natural/manter o tom.
// - Mídia de cabelo sem cor no nome (cacheado, regional, ondulado) sai depois de qualquer cor dita.
//
// Só vale para os tenants da lista. Os demais seguem exatamente como antes.
export const MEDIA_COLOR_GUARD_TENANT_IDS = new Set<string>([
  'd69c3b3a-5b96-4c7d-9bce-ea7c44533d5c', // DALU — pedido do Fagner (27/11/2026)
]);

export const MEDIA_COLOR_ASK_REPLY =
  'Antes de te mostrar as opções, me conta: você quer manter o seu tom ou prefere clarear/ficar loira? 😊';

const norm = (s: string) =>
  ` ${(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;

const TECHNIQUE_RE = /\b(fita|fitas|queratina|capsula|capsulas|microcapsula|tela|telas|microlink|costura|costurada|metodo|nanopele)\b/;
const HAIR_RE = /\b(cabelo|cabelos|loiro|loiros|loira|castanho|castanhos|cacheado|cacheados|ondulado|ondulados|liso|regional|regionais|importado|brasileiro|brasileiros|megahir|megahair)\b/;
const MEDIA_BLONDE_RE = /\b(loiro|loiros|loira|loiras|iluminado|iluminada|mechas|platinado)\b/;
const MEDIA_DARK_RE = /\b(castanho|castanhos|castanha|escuro|preto|moreno|morena)\b/;

// "claro"/"clara" sozinhos ficam de fora: "claro que sim" não é pedido de cor.
const WANTS_BLONDE_RE = /\b(loir\w*|clarear|clareando|clareamento|clarinh\w*|mais clar[oa]|mecha\w*|luzes|iluminad\w*|platinad\w*|dourad\w*|mel)\b/;
const WANTS_DARK_RE = /\b(castanh\w*|escur\w*|morena|moreno|preto|preta|natural|mesma cor|meu tom|minha cor|manter (o |a )?(meu |minha )?(tom|cor)|ruiv\w*|chocolate)\b/;

export type MediaKind = 'technique' | 'blonde' | 'dark' | 'hair' | 'other';

export function mediaKind(name: string): MediaKind {
  const n = norm(name);
  if (TECHNIQUE_RE.test(n)) return 'technique';
  if (MEDIA_BLONDE_RE.test(n)) return 'blonde';
  if (MEDIA_DARK_RE.test(n)) return 'dark';
  if (HAIR_RE.test(n)) return 'hair';
  return 'other';
}

// `leadText`: tudo o que a cliente escreveu na conversa (inclusive a mensagem atual).
export function filterMediaByColor(
  mediaNames: string[],
  leadText: string,
): { allowed: string[]; blocked: string[] } {
  const t = norm(leadText);
  const blonde = WANTS_BLONDE_RE.test(t);
  const dark = WANTS_DARK_RE.test(t);
  const allowed: string[] = [];
  const blocked: string[] = [];
  for (const name of mediaNames) {
    const kind = mediaKind(name);
    const ok =
      kind === 'technique' || kind === 'other' ||
      (kind === 'blonde' && blonde) ||
      (kind === 'dark' && dark) ||
      (kind === 'hair' && (blonde || dark));
    (ok ? allowed : blocked).push(name);
  }
  return { allowed, blocked };
}
