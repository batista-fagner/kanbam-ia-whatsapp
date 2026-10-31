// Tempo (s) que a IA espera em silêncio da cliente antes de responder, juntando as
// mensagens picadas numa resposta só. O valor do tenant vem de whatsapp_config
// (reply_delay_seconds, editável em Configurações); sem valor, vale o padrão abaixo.
export const DEFAULT_REPLY_DELAY_SECONDS = 15;
export const MIN_REPLY_DELAY_SECONDS = 5;
export const MAX_REPLY_DELAY_SECONDS = 120;

// Tempos que já existiam antes da tela (pedidos pontuais). A migration grava esses
// valores na coluna; aqui só servem de reserva se a leitura do banco falhar.
const LEGACY_OVERRIDES_SECONDS: Record<string, number> = {
  '1ff3f0b3-52d1-4e89-b7bf-552d0556de29': 25, // claudia_teste_multiagente
  'e624e817-5b6c-4840-b0ea-269eb78afe8d': 5, // alex_teste
  '3ff8efe4-7a7c-44ee-b98b-548e5921b174': 45, // Heline / HE Cabelos
  '69420c85-634c-451d-af45-2ebccf8aa1d3': 30, // Mult Festa
  'd69c3b3a-5b96-4c7d-9bce-ea7c44533d5c': 35, // DALU
  '2c562828-0fe9-43c8-bad0-77a931968afc': 35, // admin
};

const configured = new Map<string, number | null>();

export function sanitizeReplyDelay(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return null;
  return Math.min(MAX_REPLY_DELAY_SECONDS, Math.max(MIN_REPLY_DELAY_SECONDS, n));
}

export function setReplyDelay(tenantId: string, seconds: number | null): void {
  configured.set(tenantId, seconds);
}

export function getReplyDelaySeconds(tenantId: string): number {
  return configured.get(tenantId) ?? LEGACY_OVERRIDES_SECONDS[tenantId] ?? DEFAULT_REPLY_DELAY_SECONDS;
}
