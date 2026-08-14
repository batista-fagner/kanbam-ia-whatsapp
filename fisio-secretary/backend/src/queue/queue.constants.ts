// Nomes de fila e de job em um lugar só — produtor e processor precisam concordar
// exatamente na string, e errar isso não quebra o build, só faz o job nunca rodar.

export const PIX_QUEUE_NAME = 'pix-polling';
export const JOB_CHECK_TENANT = 'check-tenant';
export const JOB_CHECK_IMPLANTACAO = 'check-implantacao';
export const JOB_DEEP_RECONCILE = 'deep-reconcile';

export const FOLLOWUP_QUEUE_NAME = 'followup-dispatch';
export const JOB_DISPATCH_FOLLOWUP = 'dispatch';

// Liga o caminho novo (filas) no lugar dos @Cron que varrem o banco. Qualquer valor
// diferente de 'bullmq' mantém o comportamento legado — é a chave de rollback.
export const QUEUE_ENGINE_BULLMQ = 'bullmq';
