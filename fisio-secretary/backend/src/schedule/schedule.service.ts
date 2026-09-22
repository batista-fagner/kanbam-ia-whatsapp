import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In } from 'typeorm';
import { TenantSchedule, WeeklyHours, WeeklyHoursInterval } from '../common/entities/tenant-schedule.entity';
import { ScheduleBlock } from '../common/entities/schedule-block.entity';
import { Appointment } from '../common/entities/appointment.entity';

const TZ = 'America/Sao_Paulo';
const DAY_NAMES_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface UpsertScheduleDto {
  enabled?: boolean;
  slotMinutes?: number;
  capacity?: number;
  bookingWindowDays?: number;
  minNoticeHours?: number;
  weeklyHours?: WeeklyHours;
}

export interface CreateBlockDto {
  startDateTime: string | Date;
  endDateTime: string | Date;
  reason?: string | null;
}

export interface DaySlots {
  date: string; // YYYY-MM-DD
  weekday: string; // "seg", "ter"...
  closed: boolean;
  slots: string[]; // "HH:MM" livres
}

// Extrai data/hora civis em America/Sao_Paulo de um Date (mesma técnica de buildDateBlock
// em ai.service.ts — soma de ms em vez de setDate evita bug de DST, e o Brasil não observa
// DST atualmente, então o offset -03:00 é sempre fixo).
function formatInTZ(d: Date): { date: string; weekdayIdx: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
  }).formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)!.value;
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    weekdayIdx: weekdayMap[get('weekday')],
    hour: parseInt(get('hour'), 10),
    minute: parseInt(get('minute'), 10),
  };
}

// Monta um Date a partir de uma data civil + hora em São Paulo — mesmo padrão de
// parseBrazilianDateTime em evolution.controller.ts (offset -03:00 fixo).
function toSPDate(dateStr: string, hhmm: string): Date {
  return new Date(`${dateStr}T${hhmm}:00-03:00`);
}

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function* iterateSlots(interval: WeeklyHoursInterval, slotMinutes: number): Generator<string> {
  let cursor = timeToMinutes(interval.start);
  const end = timeToMinutes(interval.end);
  while (cursor + slotMinutes <= end) {
    yield `${String(Math.floor(cursor / 60)).padStart(2, '0')}:${String(cursor % 60).padStart(2, '0')}`;
    cursor += slotMinutes;
  }
}

@Injectable()
export class ScheduleService {
  constructor(
    @InjectRepository(TenantSchedule) private readonly scheduleRepo: Repository<TenantSchedule>,
    @InjectRepository(ScheduleBlock) private readonly blockRepo: Repository<ScheduleBlock>,
    @InjectRepository(Appointment) private readonly appointmentRepo: Repository<Appointment>,
  ) {}

  async getSchedule(tenantId: string): Promise<TenantSchedule> {
    const existing = await this.scheduleRepo.findOne({ where: { tenantId } });
    if (existing) return existing;
    return this.scheduleRepo.create({ tenantId, enabled: false, slotMinutes: 60, capacity: 1, bookingWindowDays: 14, minNoticeHours: 2, weeklyHours: {} });
  }

  async upsertSchedule(tenantId: string, dto: UpsertScheduleDto): Promise<TenantSchedule> {
    let schedule = await this.scheduleRepo.findOne({ where: { tenantId } });
    if (!schedule) schedule = this.scheduleRepo.create({ tenantId });

    if (dto.slotMinutes !== undefined) {
      if (![15, 30, 45, 60, 90, 120].includes(dto.slotMinutes)) throw new BadRequestException('Duração do atendimento inválida');
      schedule.slotMinutes = dto.slotMinutes;
    }
    if (dto.capacity !== undefined) {
      if (!Number.isInteger(dto.capacity) || dto.capacity < 1) throw new BadRequestException('Vagas por horário deve ser no mínimo 1');
      schedule.capacity = dto.capacity;
    }
    if (dto.bookingWindowDays !== undefined) {
      if (!Number.isInteger(dto.bookingWindowDays) || dto.bookingWindowDays < 1 || dto.bookingWindowDays > 90) throw new BadRequestException('Janela de agendamento inválida (1 a 90 dias)');
      schedule.bookingWindowDays = dto.bookingWindowDays;
    }
    if (dto.minNoticeHours !== undefined) {
      if (!Number.isInteger(dto.minNoticeHours) || dto.minNoticeHours < 0) throw new BadRequestException('Antecedência mínima inválida');
      schedule.minNoticeHours = dto.minNoticeHours;
    }
    if (dto.weeklyHours !== undefined) {
      schedule.weeklyHours = this.validateWeeklyHours(dto.weeklyHours);
    }
    if (dto.enabled !== undefined) schedule.enabled = dto.enabled;

    return this.scheduleRepo.save(schedule);
  }

  private validateWeeklyHours(weeklyHours: WeeklyHours): WeeklyHours {
    const cleaned: WeeklyHours = {};
    for (const [day, intervals] of Object.entries(weeklyHours ?? {})) {
      const dayNum = Number(day);
      if (!Number.isInteger(dayNum) || dayNum < 0 || dayNum > 6) throw new BadRequestException(`Dia da semana inválido: ${day}`);
      if (!Array.isArray(intervals) || intervals.length === 0) continue;
      const sorted = [...intervals].sort((a, b) => a.start.localeCompare(b.start));
      let prevEnd = -1;
      for (const iv of sorted) {
        if (!TIME_RE.test(iv.start) || !TIME_RE.test(iv.end)) throw new BadRequestException(`Horário inválido no dia ${day}`);
        const startMin = timeToMinutes(iv.start);
        const endMin = timeToMinutes(iv.end);
        if (startMin >= endMin) throw new BadRequestException(`Intervalo inválido no dia ${day}: início deve ser antes do fim`);
        if (startMin < prevEnd) throw new BadRequestException(`Intervalos sobrepostos no dia ${day}`);
        prevEnd = endMin;
      }
      cleaned[day] = sorted;
    }
    return cleaned;
  }

  async listBlocks(tenantId: string): Promise<ScheduleBlock[]> {
    return this.blockRepo.find({ where: { tenantId }, order: { startDateTime: 'ASC' } });
  }

  async createBlock(tenantId: string, dto: CreateBlockDto): Promise<ScheduleBlock> {
    const start = typeof dto.startDateTime === 'string' ? new Date(dto.startDateTime) : dto.startDateTime;
    const end = typeof dto.endDateTime === 'string' ? new Date(dto.endDateTime) : dto.endDateTime;
    if (!(start < end)) throw new BadRequestException('O início do bloqueio deve ser antes do fim');
    const block = this.blockRepo.create({ tenantId, startDateTime: start, endDateTime: end, reason: dto.reason ?? null });
    return this.blockRepo.save(block);
  }

  async deleteBlock(id: string, tenantId: string): Promise<void> {
    const result = await this.blockRepo.delete({ id, tenantId });
    if (result.affected === 0) throw new NotFoundException('Bloqueio não encontrado');
  }

  // Horários livres dia a dia, dentro da janela de agendamento. Retorna [] se o tenant não
  // tem agenda configurada ou ela está desligada (chamador deve tratar como "sem agenda").
  async getAvailableSlots(tenantId: string, opts: { days?: number; excludeLeadId?: string } = {}): Promise<DaySlots[]> {
    const schedule = await this.scheduleRepo.findOne({ where: { tenantId } });
    if (!schedule || !schedule.enabled) return [];

    const days = Math.min(opts.days ?? schedule.bookingWindowDays, schedule.bookingWindowDays);
    const now = new Date();
    const earliestAllowed = new Date(now.getTime() + schedule.minNoticeHours * 3600 * 1000);
    const todayInfo = formatInTZ(now);
    const rangeStart = toSPDate(todayInfo.date, '00:00');
    const rangeEnd = new Date(rangeStart.getTime() + days * 86400000);

    const [blocks, appts] = await Promise.all([
      this.blockRepo.find({ where: { tenantId } }),
      this.appointmentRepo.find({ where: { tenantId, startDateTime: Between(rangeStart, rangeEnd), status: In(['agendado', 'confirmado']) } }),
    ]);
    const relevantBlocks = blocks.filter(b => b.endDateTime > rangeStart && b.startDateTime < rangeEnd);

    const result: DaySlots[] = [];
    for (let i = 0; i < days; i++) {
      const dayMoment = new Date(now.getTime() + i * 86400000);
      const info = formatInTZ(dayMoment);
      const intervals = schedule.weeklyHours[String(info.weekdayIdx)] ?? [];
      if (intervals.length === 0) {
        result.push({ date: info.date, weekday: DAY_NAMES_SHORT[info.weekdayIdx], closed: true, slots: [] });
        continue;
      }
      const daySlots: string[] = [];
      for (const interval of intervals) {
        for (const hhmm of iterateSlots(interval, schedule.slotMinutes)) {
          const slotStart = toSPDate(info.date, hhmm);
          if (slotStart < earliestAllowed) continue;
          const slotEnd = new Date(slotStart.getTime() + schedule.slotMinutes * 60000);
          const blocked = relevantBlocks.some(b => b.startDateTime < slotEnd && b.endDateTime > slotStart);
          if (blocked) continue;
          const overlapping = appts.filter(a => {
            if (opts.excludeLeadId && a.leadId === opts.excludeLeadId) return false;
            const aStart = a.startDateTime;
            const aEnd = a.endDateTime ?? new Date(aStart.getTime() + schedule.slotMinutes * 60000);
            return aStart < slotEnd && aEnd > slotStart;
          });
          if (overlapping.length >= schedule.capacity) continue;
          daySlots.push(hhmm);
        }
      }
      result.push({ date: info.date, weekday: DAY_NAMES_SHORT[info.weekdayIdx], closed: false, slots: daySlots });
    }
    return result;
  }

  // Checagem pontual de um horário específico — usada no momento de criar o agendamento
  // (proteção contra corrida e contra a IA alucinar um horário fora da lista oferecida).
  // Retorna true (livre) se o tenant não tem agenda ativa — mantém o comportamento antigo.
  async isSlotAvailable(tenantId: string, start: Date, excludeLeadId?: string): Promise<boolean> {
    const schedule = await this.scheduleRepo.findOne({ where: { tenantId } });
    if (!schedule || !schedule.enabled) return true;

    const info = formatInTZ(start);
    const intervals = schedule.weeklyHours[String(info.weekdayIdx)] ?? [];
    const minutesOfDay = info.hour * 60 + info.minute;
    const withinHours = intervals.some(iv => minutesOfDay >= timeToMinutes(iv.start) && minutesOfDay + schedule.slotMinutes <= timeToMinutes(iv.end));
    if (!withinHours) return false;

    const earliestAllowed = new Date(Date.now() + schedule.minNoticeHours * 3600 * 1000);
    if (start < earliestAllowed) return false;

    const end = new Date(start.getTime() + schedule.slotMinutes * 60000);
    const blocks = await this.blockRepo.find({ where: { tenantId } });
    if (blocks.some(b => b.startDateTime < end && b.endDateTime > start)) return false;

    const appts = await this.appointmentRepo.find({ where: { tenantId, status: In(['agendado', 'confirmado']) } });
    const overlapping = appts.filter(a => {
      if (excludeLeadId && a.leadId === excludeLeadId) return false;
      const aStart = a.startDateTime;
      const aEnd = a.endDateTime ?? new Date(aStart.getTime() + schedule.slotMinutes * 60000);
      return aStart < end && aEnd > start;
    });
    return overlapping.length < schedule.capacity;
  }

  // Próximos horários livres, pra sugerir alternativa quando um horário escolhido acabou de
  // ser preenchido (ver evolution.controller.ts, action="schedule").
  async nextAvailableSlots(tenantId: string, count = 3): Promise<string[]> {
    const days = await this.getAvailableSlots(tenantId, {});
    const flat: string[] = [];
    for (const d of days) {
      if (d.closed) continue;
      const dd = d.date.split('-').reverse().slice(0, 2).join('/');
      for (const hhmm of d.slots) {
        flat.push(`${dd} às ${hhmm}`);
        if (flat.length >= count) return flat;
      }
    }
    return flat;
  }

  // Texto compacto injetado no prompt da IA — deve ficar no final do systemPrompt (bloco
  // variável), igual buildDateBlock, para não quebrar o cache implícito.
  // Retorna null se a agenda não está ativa — o chamador então usa o comportamento antigo.
  async buildAvailabilityBlock(tenantId: string): Promise<string | null> {
    const schedule = await this.scheduleRepo.findOne({ where: { tenantId } });
    if (!schedule || !schedule.enabled) return null;

    const days = await this.getAvailableSlots(tenantId, {});
    const openDays = days.filter(d => !d.closed);
    if (openDays.length === 0) {
      return `════════ HORÁRIOS DISPONÍVEIS ════════\nNenhum horário livre nos próximos dias — avise a cliente que a equipe vai confirmar a data.`;
    }
    const lines = openDays.map(d => {
      const label = `${d.weekday} ${d.date.split('-').reverse().slice(0, 2).join('/')}`;
      return d.slots.length ? `- ${label}: ${d.slots.join(', ')}` : `- ${label}: (lotado)`;
    });
    return `════════ HORÁRIOS DISPONÍVEIS — ESTA REGRA SUBSTITUI QUALQUER INSTRUÇÃO ANTERIOR SOBRE HORÁRIO E DISPONIBILIDADE ════════\nOfereça e agende SOMENTE horários desta lista, exatamente como aparecem. NUNCA use 09:00 fixo. NUNCA invente ou prometa horário fora daqui.\n${lines.join('\n')}`;
  }
}
