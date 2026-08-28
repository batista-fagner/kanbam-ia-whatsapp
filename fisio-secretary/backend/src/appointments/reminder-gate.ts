/** Antecedência usada quando o tenant não tem `hoursBefore` gravado. É o valor
 *  fixo que o lembrete tinha antes de a antecedência virar configurável, então
 *  config antiga continua disparando exatamente como disparava. */
export const DEFAULT_REMINDER_HOURS = 24;

/** Teto aceito para a antecedência: 7 dias. */
export const MAX_REMINDER_HOURS = 168;

export type AppointmentReminderConfig = { enabled?: boolean; message?: string; hoursBefore?: number } | null | undefined;

/** Normaliza a antecedência vinda do jsonb/HTTP: inteiro entre 1 e 168, default 24. */
export function resolveReminderHours(raw: unknown): number {
  const parsed = Math.round(Number(raw));
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_REMINDER_HOURS;
  return Math.min(parsed, MAX_REMINDER_HOURS);
}

/**
 * Decide se este tenant dispara lembrete neste tick e com qual antecedência.
 * Regra de produto: sem `enabled` OU sem mensagem preenchida, o lead não recebe
 * nada — mensagem vazia é o jeito de desligar o recurso.
 */
export function resolveReminderGate(reminder: AppointmentReminderConfig): { skip: true } | { skip: false; hoursBefore: number } {
  if (!reminder?.enabled || !reminder.message?.trim()) return { skip: true };
  return { skip: false, hoursBefore: resolveReminderHours(reminder.hoursBefore) };
}
