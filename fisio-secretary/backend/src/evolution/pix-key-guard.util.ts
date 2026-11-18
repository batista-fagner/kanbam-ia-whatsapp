// Trava de chave Pix inventada.
//
// Bug real (DALU, 23/10 e 13/11/2026): o prompt dizia "só envie chave Pix fornecida pelo
// sistema/cadastro, não invente", mas não havia chave nenhuma cadastrada. Quando a cliente
// pedia a chave, a IA inventava: "dalucabelos@contato.com.br", "[INSERIR CHAVE PIX OFICIAL]",
// "00.000.000/0001-00", "123e4567-e89b-12d3-a456-426614174000". Cliente pagando numa chave
// errada é o pior erro possível, e o modelo desobedece o prompt às vezes — por isso em código.
//
// Regra: numa resposta que fala de Pix/chave, todo dado com cara de chave (e-mail, CPF, CNPJ,
// celular, chave aleatória) precisa estar ESCRITO no prompt do tenant. Sem chave no prompt,
// nenhuma passa; quando a dona cadastrar a chave no prompt, só ela passa. Placeholder do
// tipo "[INSERIR CHAVE]" é sempre barrado.
//
// Só vale para os tenants da lista (motor legacy: o prompt é o custom_prompt_*). Os demais
// seguem exatamente como antes.
export const PIX_KEY_GUARD_TENANT_IDS = new Set<string>([
  'd69c3b3a-5b96-4c7d-9bce-ea7c44533d5c', // DALU
]);

export const PIX_KEY_BLOCKED_REPLY =
  'Vou pedir para alguém da nossa equipe te enviar os dados de pagamento certinho, tá bom? Já já te chamam por aqui 😊';

const PIX_CONTEXT = /\bpix\b|\bchave\b/i;

const PLACEHOLDER = /\[[^\]\n]{0,80}(chave|pix|inserir|cnpj|cpf|dados)[^\]\n]{0,80}\]|x{4,}/i;

// Ordem importa: CNPJ antes de CPF/celular para o mesmo trecho não ser lido duas vezes.
const KEY_PATTERNS: Array<{ kind: string; re: RegExp; norm: (s: string) => string }> = [
  { kind: 'aleatória', re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, norm: (s) => s.toLowerCase() },
  { kind: 'e-mail', re: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, norm: (s) => s.toLowerCase() },
  { kind: 'CNPJ', re: /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, norm: (s) => s.replace(/\D/g, '') },
  { kind: 'CPF', re: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, norm: (s) => s.replace(/\D/g, '') },
  { kind: 'celular', re: /(?:\+?55[\s-]?)?\(?\d{2}\)?[\s-]?9\d{4}[\s-]?\d{4}\b/g, norm: (s) => s.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '') },
];

function extractKeys(text: string): Array<{ kind: string; raw: string; norm: string }> {
  const found: Array<{ kind: string; raw: string; norm: string }> = [];
  let rest = text ?? '';
  for (const p of KEY_PATTERNS) {
    rest = rest.replace(p.re, (raw) => {
      found.push({ kind: p.kind, raw, norm: p.norm(raw) });
      return ' ';
    });
  }
  return found;
}

export function checkPixKeys(reply: string, allowedSource: string): { blocked: boolean; reasons: string[] } {
  const text = reply ?? '';
  if (!PIX_CONTEXT.test(text)) return { blocked: false, reasons: [] };

  const reasons: string[] = [];
  const placeholder = text.match(PLACEHOLDER);
  if (placeholder) reasons.push(`placeholder "${placeholder[0]}"`);

  const allowed = new Set(extractKeys(allowedSource ?? '').map((k) => k.norm));
  for (const k of extractKeys(text)) {
    if (!allowed.has(k.norm)) reasons.push(`${k.kind} fora do prompt "${k.raw}"`);
  }
  return { blocked: reasons.length > 0, reasons };
}
