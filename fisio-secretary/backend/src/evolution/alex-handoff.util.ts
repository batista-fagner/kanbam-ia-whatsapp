// Encaminhamento ao Alex (S&A Cabelos Naturais): etiqueta + aviso.
//
// Quando a cliente diz algo como "quero esse" / "manda o pix" / "pode reservar", o sistema
// responde a frase fixa "Perfeito! Vou deixar tudo encaminhado e o Alex já continua com
// você…", desliga a IA daquele lead e avisa o número de Configurações (ver
// PURCHASE_HANDOFF_TENANT_IDS no evolution.controller.ts). Até 18/11/2026 o lead ficava só
// com a etiqueta genérica "qualificado" (2.037 leads, quase metade da base) e o aviso trazia
// só nome, telefone e a palavra-chave — sem o que a cliente disse e sem log de entrega.
// Aqui ficam as peças puras: nome da etiqueta, número e texto do aviso.

export const ALEX_HANDOFF_LABEL = 'aguardando-alex';

// Tenants em que o encaminhamento ao Alex ganha etiqueta + aviso (S&A Cabelos Naturais).
export const ALEX_HANDOFF_TENANT_IDS = new Set<string>(['badfc5d9-d522-4253-a788-28b3ebe41753']);

// Quando a IA desliga sozinha (shouldIgnore) por estes motivos, a cliente NÃO está esperando o
// Alex: é xingamento, emergência ou assunto fora de escopo marcado como lixo. Não avisa.
export const ALEX_HANDOFF_SKIP_TAGS = ['inativo', 'desrespeitoso', 'emergencia', 'fora-de-escopo'];

export function shouldNotifyAlexForAiHandoff(tags: string[] | null | undefined): boolean {
  const set = new Set((tags ?? []).map((t) => String(t).toLowerCase()));
  return !ALEX_HANDOFF_SKIP_TAGS.some((t) => set.has(t));
}

// Só dígitos; número brasileiro de 10 ou 11 dígitos (sem DDI) ganha o 55. O número do Alex em
// Configurações foi salvo com 11 dígitos, sem o 55.
export function normalizeNotifyPhone(raw: string | null | undefined): string {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

function oneLine(s: string, max: number): string {
  const t = (s ?? '').replace(/\|\|\|/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

// Quem encaminhou: a regra fixa por palavra-chave (código) ou a própria IA desligando o lead.
export type AlexHandoffTrigger = { source: 'keyword'; keyword: string } | { source: 'ia'; reply: string };

export interface AlexHandoffInfo {
  name: string | null | undefined;
  phone: string; // telefone do lead (já vem com 55 do WhatsApp)
  trigger: AlexHandoffTrigger;
  customerText: string; // o que a cliente escreveu (mensagens juntadas pelo debounce)
}

export function buildAlexHandoffText(info: AlexHandoffInfo): string {
  const who = (info.name ?? '').trim() || info.phone;
  const digits = normalizeNotifyPhone(info.phone);
  const t = info.trigger;
  const lines = [
    t.source === 'keyword' ? '🛒 *Cliente esperando você!*' : '🔔 *A IA passou uma cliente para você!*',
    '',
    `Cliente: ${who}`,
    digits ? `Conversa: https://wa.me/${digits}` : `Telefone: ${info.phone}`,
    `Ela disse: "${oneLine(info.customerText, 280)}"`,
    t.source === 'keyword' ? `Gatilho: "${t.keyword}"` : `A IA respondeu: "${oneLine(t.reply, 200)}"`,
    '',
    `A IA parou nessa conversa e o lead ficou com a etiqueta "${ALEX_HANDOFF_LABEL}". Responda por lá; quando terminar, tire a etiqueta.`,
  ];
  return lines.join('\n');
}
