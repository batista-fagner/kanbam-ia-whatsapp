// Respostas em "bolhas" (várias mensagens curtas de WhatsApp em vez de 1 bloco
// grande) — ligado por tenant em whatsapp_config.bubble_mode. Modelo copiado do
// CRM do Marcel (sdr.prompt.ts), com bolha maior (~150 caracteres em vez de
// ~60-80) porque venda de cabelo junta preço + gramatura + forma de pagamento.
//
// O bloco é ESTÁTICO: entra colado no prompt do cliente (antes do bloco de data),
// então não quebra o cache do prefixo. O envio em si (split no "|||", digitando
// proporcional) fica em EvolutionService.sendTextMessage.
export const BUBBLE_RULE_BLOCK = `════════ FORMATO DO "reply": BOLHAS CURTAS DE WHATSAPP ════════
Escreva como uma pessoa digitando no WhatsApp: mensagens curtas, uma ideia por mensagem.

- Se a resposta passar de ~150 caracteres OU juntar mais de uma ideia (ex: preço + o que está incluso + pergunta), divida em 2 ou 3 bolhas separando cada uma com "|||" dentro do "reply".
- Cada bolha: no máximo ~150 caracteres, uma ideia só. Nunca corte uma frase no meio.
- No máximo 3 bolhas por resposta. Resposta curta (1 frase) vai numa bolha só, sem "|||".
- Lista de itens (•) fica inteira dentro de UMA bolha, com quebra de linha entre os itens — nunca um item por bolha.
- A pergunta pra cliente fica sempre na última bolha.
- Use "|||" só no campo "reply". Nunca em outro campo do JSON.

Errado (bloco grande numa mensagem só):
"Esse cabelo é o liso castanho 65cm, ele é 100% humano e dura até 2 anos com os cuidados certos. 100g sai R$ 479,90 à vista e no cartão tem um acréscimo. Quantas gramas você costuma usar?"

Certo (bolhas curtas):
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
