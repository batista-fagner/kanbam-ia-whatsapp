// Regras puras da automação de Instagram (sem banco, sem rede) — tudo aqui é testado em
// instagram.util.spec.ts com payloads no formato real da Meta.

export type InstagramInboundEvent =
  | {
      kind: 'comment';
      accountIgId: string; // conta que recebeu o comentário (entry.id)
      externalId: string; // id do comentário
      senderIgId: string;
      senderUsername: string | null;
      mediaId: string;
      text: string;
    }
  | {
      kind: 'dm';
      accountIgId: string;
      externalId: string; // mid da mensagem
      senderIgId: string;
      text: string;
    };

// Achata o webhook da Meta (API do Instagram com login do Instagram) nos eventos que
// interessam: comentário novo e mensagem recebida. Fica de fora:
// - eco (mensagem enviada pela própria conta) — `is_echo` vem DENTRO de `message`;
// - mensagem apagada, leitura, reação, clique em botão (postback);
// - comentário sem id/post (payload de teste incompleto).
export function extractInstagramEvents(body: any): InstagramInboundEvent[] {
  const out: InstagramInboundEvent[] = [];
  for (const entry of Array.isArray(body?.entry) ? body.entry : []) {
    const accountIgId = entry?.id != null ? String(entry.id) : '';
    if (!accountIgId) continue;

    for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
      if (change?.field !== 'comments') continue;
      const v = change.value ?? {};
      if (!v.id || !v.media?.id || !v.from?.id) continue;
      out.push({
        kind: 'comment',
        accountIgId,
        externalId: String(v.id),
        senderIgId: String(v.from.id),
        senderUsername: v.from.username ? String(v.from.username) : null,
        mediaId: String(v.media.id),
        text: String(v.text ?? ''),
      });
    }

    for (const m of Array.isArray(entry.messaging) ? entry.messaging : []) {
      const msg = m?.message;
      if (!msg || msg.is_echo || msg.is_deleted || !msg.mid || !m.sender?.id) continue;
      out.push({
        kind: 'dm',
        accountIgId,
        externalId: String(msg.mid),
        senderIgId: String(m.sender.id),
        text: String(msg.text ?? (msg.attachments ? '[anexo]' : '')),
      });
    }
  }
  return out;
}

export function normalizeText(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Palavras-chave separadas por vírgula ou quebra de linha. Bate se o comentário CONTÉM
// alguma delas, sem diferença de acento e maiúscula ("Eu QUERO!!" bate com "eu quero").
export function parseKeywords(raw: string): string[] {
  return (raw ?? '')
    .split(/[\n,]/)
    .map((k) => normalizeText(k))
    .filter(Boolean);
}

export function commentMatches(triggerMode: string, keywordsRaw: string, text: string): boolean {
  if (triggerMode === 'any') return true;
  const t = normalizeText(text);
  return parseKeywords(keywordsRaw).some((k) => t.includes(k));
}

// Só dígitos; número brasileiro sem DDI ganha o 55.
export function normalizeWhatsappPhone(raw: string | null | undefined): string {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

export function buildWhatsappLink(phone: string | null | undefined, text?: string | null): string | null {
  const digits = normalizeWhatsappPhone(phone);
  if (!digits) return null;
  const msg = (text ?? '').trim();
  return msg ? `https://wa.me/${digits}?text=${encodeURIComponent(msg)}` : `https://wa.me/${digits}`;
}

// {nome} vira o @ da pessoa. Sem @ conhecido, o marcador some sem deixar "Oi , tudo bem".
export function renderTemplate(template: string, username: string | null | undefined): string {
  const name = username ? `@${username.replace(/^@/, '')}` : '';
  return (template ?? '')
    .replace(/\{nome\}/gi, name)
    .replace(/[ \t]+([,.!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^[ \t]*[,]\s*/gm, '')
    .trim();
}

export const BUTTON_LABEL_MAX = 20; // limite da Meta para o título do botão
export const BUTTON_TEXT_MAX = 640; // limite da Meta para o texto do modelo de botão

// Mensagem com botão "abrir link" (modelo de botão do Instagram). Sem link, vai só o texto.
export function buildDmMessage(text: string, buttonLabel: string | null | undefined, url: string | null): any {
  const body = (text ?? '').trim().slice(0, BUTTON_TEXT_MAX);
  const title = (buttonLabel ?? '').trim().slice(0, BUTTON_LABEL_MAX) || 'Falar no WhatsApp';
  if (!url) return { text: body };
  return {
    attachment: {
      type: 'template',
      payload: {
        template_type: 'button',
        text: body,
        buttons: [{ type: 'web_url', url, title }],
      },
    },
  };
}
