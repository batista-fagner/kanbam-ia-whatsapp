// Respostas em "bolhas" (várias mensagens curtas de WhatsApp em vez de 1 bloco
// grande) — ligado por tenant em whatsapp_config.bubble_mode. Modelo copiado do
// CRM do Marcel (sdr.prompt.ts), com bolha maior (~150 caracteres em vez de
// ~60-80) porque venda de cabelo junta preço + gramatura + forma de pagamento.
//
// O bloco é ESTÁTICO: entra colado no prompt do cliente (antes do bloco de data),
// então não quebra o cache do prefixo. O envio em si (split no "|||", digitando
// proporcional) fica em EvolutionService.sendTextMessage.
export const BUBBLE_RULE_BLOCK = `════════ FORMATO DO "reply": BOLHAS CURTAS DE WHATSAPP (OBRIGATÓRIO) ════════
Escreva como uma pessoa digitando no WhatsApp: várias mensagens curtas, uma ideia por mensagem.

- Sempre que a resposta tiver MAIS DE UMA FRASE, separe em 2 ou 3 bolhas com "|||" dentro do "reply". Ex: reação/acolhimento numa bolha, informação na outra, pergunta na última.
- Só vai numa bolha única (sem "|||") a resposta de UMA frase só.
- Cada bolha: uma ideia, no máximo ~150 caracteres. Nunca corte uma frase no meio.
- No máximo 3 bolhas por resposta.
- Lista de itens (•) fica inteira dentro de UMA bolha, com quebra de linha entre os itens — nunca um item por bolha.
- A pergunta pra cliente fica sempre na última bolha.
- Use "|||" só no campo "reply". Nunca em outro campo do JSON.

Errado (duas ideias numa bolha só):
"Que legal! Fico feliz em saber 😊 Agora me conta, qual cabelo você tá procurando hoje?"
Certo:
"Que legal! Fico feliz em saber 😊|||Agora me conta, qual cabelo você tá procurando hoje?"

Errado (bloco grande):
"Esse é o liso castanho 65cm, 100% humano e dura até 2 anos com os cuidados certos. 100g sai R$ 479,90 à vista. Quantas gramas você costuma usar?"
Certo:
"Esse é o liso castanho 65cm, 100% humano e dura até 2 anos com os cuidados certos 😍|||100g sai R$ 479,90 à vista.|||Quantas gramas você costuma usar?"`;

// Separa a resposta em bolhas. Proteções determinísticas (nunca depende só do prompt):
// - bolhas seguidas que começam com "•" voltam a ser uma só (lista não vira 1 msg por item);
// - teto de `max` bolhas: o excedente é juntado na última, nunca descartado.
export function splitBubbles(text: string, max = 3): string[] {
  const raw = (text ?? '').split('|||').map((b) => b.trim()).filter(Boolean);
  const merged: string[] = [];
  for (const bubble of raw) {
    const prev = merged[merged.length - 1];
    if (bubble.startsWith('•') && prev !== undefined && /(^|\n)•[^\n]*$/.test(prev)) {
      merged[merged.length - 1] = `${prev}\n${bubble}`;
    } else {
      merged.push(bubble);
    }
  }
  if (merged.length <= max) return merged;
  return [...merged.slice(0, max - 1), merged.slice(max - 1).join('\n\n')];
}

// Bolha que ANUNCIA o envio da mídia ("vou te mostrar…", "dá uma olhadinha nesse
// vídeo", "segue o vídeo"). Depois de action=send_media a mídia chega na cliente
// ANTES do texto, então esse anúncio sai atrasado e soa errado (visto em prod,
// 13/10/2026, HE Cabelos: o loiro já estava na tela e a IA dizia "vou te mostrar").
const MEDIA_ANNOUNCE_RE = /\b(vou|deixa eu|deixe eu|posso|irei)\s+(te\s+)?(mostrar|mandar|enviar)\b|\bte\s+(mostro|mando|envio)\b|d[aá] uma olhad|\bsegue\s+(o|a|um|uma)\b|\baqui\s+est[aá]\s+(o|a|um|uma)\s+(v[ií]deo|foto|imagem)/i;

// Trava determinística (o prompt sozinho não segura: o modelo segue a regra geral
// de "2 a 3 bolhas"). Depois de enviar mídia, a resposta tem no máximo `max` bolhas:
// 1) descarta bolhas que só anunciam o envio (nunca a última — é a pergunta de ação);
// 2) se ainda passar do limite, mantém a última bolha (a pergunta que faz a
//    conversa andar) e junta as anteriores numa só, sem perder conteúdo.
// Depois de uma mídia a cliente já está vendo o cabelo e leu a legenda: se a reply ficou longa
// (elogio + descrição + pergunta), fica só a pergunta final. Reply curta, sem "?" no fim ou
// em várias bolhas passa intacta.
export function trimMediaReplyToQuestion(reply: string, maxChars = 110): string {
  const text = (reply ?? '').trim();
  if (text.length <= maxChars || text.includes('|||') || !text.endsWith('?')) return text;
  const sentences = text.split(/(?<=[.!?…])\s+/);
  if (sentences.length < 2) return text;
  const last = sentences[sentences.length - 1].replace(/^[^\p{L}]+/u, '').trim();
  return last.length >= 8 ? last : text;
}

export function limitReplyBubblesAfterMedia(reply: string, max = 2): string {
  const bubbles = (reply ?? '').split('|||').map((b) => b.trim()).filter(Boolean);
  if (bubbles.length <= max) return bubbles.join('|||');
  const last = bubbles.length - 1;
  let kept = bubbles.filter((b, i) => i === last || !MEDIA_ANNOUNCE_RE.test(b));
  if (kept.length > max) {
    const head = kept.slice(0, kept.length - (max - 1)).join(' ');
    kept = [head, ...kept.slice(kept.length - (max - 1))];
  }
  return kept.join('|||');
}
