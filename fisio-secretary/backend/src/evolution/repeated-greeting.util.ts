// Trava de código contra saudação/apresentação repetida (DALU): depois que a IA já falou com
// a cliente, "Oooi", "Oi", "Seja bem-vinda", "boa noite" e "Eu sou a Lu" no começo da resposta
// são cortados antes do envio. O prompt manda não repetir, mas modelo escorrega; isto garante.

const PUNCT = String.raw`[\s,!.…\p{Extended_Pictographic}️]*`;
const END = String.raw`(?![\p{L}\d])`;
const GREETING_WORD = String.raw`(?:o+i+|ol[aá]|bom dia|boa tarde|boa noite|seja bem[- ]?vinda|bem[- ]?vinda)`;
const INTRO = String.raw`(?:eu sou a|sou a|aqui é a|eu me chamo|me chamo|meu nome é)\s+lu`;

const LEADING = new RegExp(String.raw`^\s*(?:(?:${GREETING_WORD}|${INTRO})${END}${PUNCT})+`, 'iu');

// Apresentação no meio da frase ("Diana, eu me chamo Lu. Você já usou…") vira ponto final.
const MID_INTRO = new RegExp(String.raw`,?\s*\b${INTRO}${END}${PUNCT}`, 'iu');

function stripBubble(bubble: string): string {
  const stripped = bubble.replace(LEADING, '').replace(MID_INTRO, '. ').replace(/\.\s*\./g, '.');
  if (stripped === bubble) return bubble;
  const trimmed = stripped.trim();
  if (!trimmed) return '';
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export function stripRepeatedGreeting(reply: string): string {
  if (!reply) return reply;
  const bubbles = reply.split('|||').map(stripBubble).filter((b) => b.trim());
  // Resposta que era só saudação: devolve o original (melhor repetir que mandar vazio).
  if (bubbles.length === 0) return reply;
  return bubbles.join('|||');
}
