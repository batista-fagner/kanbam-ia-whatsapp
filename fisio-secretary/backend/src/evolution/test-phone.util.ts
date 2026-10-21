// Modo teste da IA: com `testOnlyPhone` preenchido no tenant, a IA só responde a esse número.
// Qualquer outro contato continua sendo salvo no Kanban, mas fica sem resposta.

export function normalizeTestPhone(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  return digits.length >= 8 ? digits : null;
}

// Compara pelos 8 últimos dígitos: o mesmo celular chega com ou sem o 9º dígito
// e com ou sem o 55 (ex.: 5571992867765 e 7192867765 são a mesma pessoa).
export function isAllowedInTestMode(testOnlyPhone: string | null | undefined, phone: string): boolean {
  const allowed = normalizeTestPhone(testOnlyPhone);
  if (!allowed) return true; // modo teste desligado
  const incoming = (phone ?? '').replace(/\D/g, '');
  return incoming.slice(-8) === allowed.slice(-8);
}
