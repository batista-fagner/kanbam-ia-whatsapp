// Telefone digitado/importado → mesmo formato que o WhatsApp manda no webhook, senão a
// cliente antiga escreve e o sistema cria OUTRO lead (com a IA ligada).
// No Brasil o número do WhatsApp segue o DDD: 11 a 28 vem com o 9 na frente
// (5511999998888), 31 em diante vem sem o 9 (558499998888). Conferido no banco em 23/10/2026:
// 15.087 leads de DDD 31+ com 12 dígitos contra 63 com 13.

const BR_MOBILE_KEEPS_NINE_MAX_DDD = 28;

export function normalizeWhatsAppPhone(raw: string): string | null {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  // "0 84 9..." (prefixo de longa distância sem operadora)
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 12 && d.startsWith('0') && !d.startsWith('055')) d = d.slice(1);

  if (d.length === 10 || d.length === 11) d = '55' + d;

  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
    const ddd = parseInt(d.slice(2, 4), 10);
    if (ddd < 11 || ddd > 99) return null;
    let local = d.slice(4);
    const keepsNine = ddd <= BR_MOBILE_KEEPS_NINE_MAX_DDD;
    if (local.length === 9) {
      if (local[0] !== '9') return null;
      if (!keepsNine) local = local.slice(1);
    } else if (keepsNine && /^[6-9]/.test(local)) {
      // celular antigo de 8 dígitos em DDD que usa o 9
      local = '9' + local;
    }
    return `55${ddd}${local}`;
  }

  // Número estrangeiro com código do país (ex.: 351..., 1...)
  if (!d.startsWith('55') && d.length >= 11 && d.length <= 15) return d;
  return null;
}

// Mesmo número na outra grafia (com/sem o 9) — para achar lead que já existe no banco
// salvo do jeito "errado" (cadastro manual antigo, exceções do WhatsApp).
export function phoneAlternates(phone: string): string[] {
  const out: string[] = [];
  if (!phone.startsWith('55')) return out;
  const ddd = phone.slice(2, 4);
  const local = phone.slice(4);
  if (local.length === 9 && local[0] === '9') out.push(`55${ddd}${local.slice(1)}`);
  if (local.length === 8 && /^[6-9]/.test(local)) out.push(`55${ddd}9${local}`);
  // Sem o 55 (como o "Novo lead" grava hoje)
  out.push(phone.slice(2), ...out.map((p) => p.slice(2)));
  return out;
}
