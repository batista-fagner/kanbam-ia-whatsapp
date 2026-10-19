import type { WeeklyHours } from '../common/entities/tenant-schedule.entity';
import { DAY_NAMES_SHORT, minutesToTime, timeToMinutes, toSPDate, weekdayOfDateStr } from '../common/utils/sp-time.util';

// Cálculo de horários livres da agenda com profissionais — funções puras (sem banco), pra
// poder testar todas as regras isoladas. Quem busca os dados é o AgendaService.

export interface AvailProfessional {
  id: string;
  sortOrder: number;
  weeklyHours: WeeklyHours; // {} = usa o horário do salão
  serviceIds: string[];
}

export interface BusyInterval {
  professionalId: string | null; // null = vale pro salão inteiro (bloqueio geral)
  start: Date;
  end: Date;
}

export interface AvailabilityContext {
  professionals: AvailProfessional[];
  salonHours: WeeklyHours;
  gridMinutes: number; // de quanto em quanto minuto um horário pode começar
  earliest: Date; // agora + antecedência mínima
  appointments: BusyInterval[]; // só os ativos (agendado/confirmado)
  blocks: BusyInterval[];
}

export interface DayAvailability {
  date: string; // YYYY-MM-DD
  weekday: string; // "seg", "ter"...
  // "HH:MM" → profissionais livres nesse início, já em ordem de preferência de escolha
  slots: { time: string; professionalIds: string[] }[];
}

export function hoursFor(p: AvailProfessional, salonHours: WeeklyHours): WeeklyHours {
  return p.weeklyHours && Object.keys(p.weeklyHours).length ? p.weeklyHours : salonHours;
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && aEnd > bStart;
}

// O profissional está livre em [start, start+duração]? Considera expediente, antecedência,
// agendamentos dele e bloqueios (do salão ou dele). `ignoreAppointmentId` serve pra remarcação.
export function isProfessionalFree(
  ctx: AvailabilityContext,
  p: AvailProfessional,
  start: Date,
  durationMinutes: number,
  opts: { ignoreEarliest?: boolean; ignoreHours?: boolean } = {},
): boolean {
  const end = new Date(start.getTime() + durationMinutes * 60000);
  if (!opts.ignoreEarliest && start < ctx.earliest) return false;
  if (!opts.ignoreHours && !fitsWorkingHours(p, ctx.salonHours, start, durationMinutes)) return false;
  if (ctx.blocks.some((b) => (b.professionalId === null || b.professionalId === p.id) && overlaps(start, end, b.start, b.end))) return false;
  if (ctx.appointments.some((a) => a.professionalId === p.id && overlaps(start, end, a.start, a.end))) return false;
  return true;
}

export function fitsWorkingHours(p: AvailProfessional, salonHours: WeeklyHours, start: Date, durationMinutes: number): boolean {
  const civil = civilOf(start);
  const intervals = hoursFor(p, salonHours)[String(civil.weekdayIdx)] ?? [];
  const startMin = civil.minutes;
  return intervals.some((iv) => startMin >= timeToMinutes(iv.start) && startMin + durationMinutes <= timeToMinutes(iv.end));
}

function civilOf(d: Date): { date: string; weekdayIdx: number; minutes: number } {
  // -03:00 fixo (ver sp-time.util)
  const sp = new Date(d.getTime() - 3 * 3600 * 1000);
  return { date: sp.toISOString().slice(0, 10), weekdayIdx: sp.getUTCDay(), minutes: sp.getUTCHours() * 60 + sp.getUTCMinutes() };
}

// Horários livres de um dia pra um serviço: união de todos os profissionais que fazem o serviço.
export function computeDay(ctx: AvailabilityContext, serviceId: string, durationMinutes: number, date: string): DayAvailability {
  const weekdayIdx = weekdayOfDateStr(date);
  const able = ctx.professionals.filter((p) => p.serviceIds.includes(serviceId));
  const byTime = new Map<string, string[]>();
  for (const p of able) {
    const intervals = hoursFor(p, ctx.salonHours)[String(weekdayIdx)] ?? [];
    for (const iv of intervals) {
      const ivEnd = timeToMinutes(iv.end);
      for (let m = timeToMinutes(iv.start); m + durationMinutes <= ivEnd; m += ctx.gridMinutes) {
        const hhmm = minutesToTime(m);
        const start = toSPDate(date, hhmm);
        if (!isProfessionalFree(ctx, p, start, durationMinutes, { ignoreHours: true })) continue;
        const list = byTime.get(hhmm) ?? [];
        list.push(p.id);
        byTime.set(hhmm, list);
      }
    }
  }
  const slots = [...byTime.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([time, ids]) => ({ time, professionalIds: orderByPreference(ctx, ids, date) }));
  return { date, weekday: DAY_NAMES_SHORT[weekdayIdx], slots };
}

// Entre os livres, prefere quem tem menos atendimentos no dia (distribui o trabalho);
// empate → ordem cadastrada.
export function orderByPreference(ctx: AvailabilityContext, ids: string[], date: string): string[] {
  const load = (id: string) => ctx.appointments.filter((a) => a.professionalId === id && civilOf(a.start).date === date).length;
  const order = (id: string) => ctx.professionals.find((p) => p.id === id)?.sortOrder ?? 0;
  return [...ids].sort((a, b) => load(a) - load(b) || order(a) - order(b));
}

// Escolhe o profissional pra um início específico (null = ninguém livre).
export function pickProfessional(ctx: AvailabilityContext, serviceId: string, durationMinutes: number, start: Date): string | null {
  const free = ctx.professionals
    .filter((p) => p.serviceIds.includes(serviceId))
    .filter((p) => isProfessionalFree(ctx, p, start, durationMinutes))
    .map((p) => p.id);
  if (!free.length) return null;
  return orderByPreference(ctx, free, civilOf(start).date)[0];
}
