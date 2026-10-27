// Follow-up automático escrito pela IA: em vez de mandar o texto fixo da raia, a IA
// escreve a mensagem com o prompt do próprio cliente + a conversa do lead, usando o
// texto da raia como objetivo (e como reserva se a geração falhar). A opção só aparece
// na tela (Regras de Alertas) para os tenants abaixo — piloto.
export const AI_WRITTEN_FOLLOWUP_TENANT_IDS = [
  'd69c3b3a-5b96-4c7d-9bce-ea7c44533d5c', // DALU (2026-10-27) — pedido do Fagner
];

export const canAiWriteFollowup = (tenantId: string): boolean =>
  AI_WRITTEN_FOLLOWUP_TENANT_IDS.includes(tenantId);
