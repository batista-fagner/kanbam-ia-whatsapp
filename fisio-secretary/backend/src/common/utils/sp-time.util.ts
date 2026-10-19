// Data/hora civis em America/Sao_Paulo. O Brasil não observa horário de verão hoje, então o
// offset -03:00 é fixo (mesmo padrão de parseBrazilianDateTime em evolution.controller.ts).
// Compartilhado pela agenda simples (schedule.service.ts) e pela agenda com profissionais (agenda/).
export const SP_TZ = 'America/Sao_Paulo';
export const DAY_NAMES_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function formatInTZ(d: Date): { date: string; weekdayIdx: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SP_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
  }).formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)!.value;
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    weekdayIdx: weekdayMap[get('weekday')],
    // Intl devolve "24" à meia-noite em alguns runtimes
    hour: parseInt(get('hour'), 10) % 24,
    minute: parseInt(get('minute'), 10),
  };
}

// Date a partir de uma data civil (YYYY-MM-DD) + hora (HH:MM) em São Paulo.
export function toSPDate(dateStr: string, hhmm: string): Date {
  return new Date(`${dateStr}T${hhmm}:00-03:00`);
}

export function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToTime(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

// Soma dias a uma data civil sem passar por fuso (meio-dia UTC evita virar o dia).
export function addDaysToDateStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function weekdayOfDateStr(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00Z`).getUTCDay();
}
