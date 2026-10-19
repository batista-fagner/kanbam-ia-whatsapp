import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, DataSource, EntityManager, In, Repository } from 'typeorm';
import { AgendaProfessional } from '../common/entities/agenda-professional.entity';
import { AgendaServiceEntity } from '../common/entities/agenda-service.entity';
import { AgendaProfessionalService } from '../common/entities/agenda-professional-service.entity';
import { Appointment, AppointmentStatus } from '../common/entities/appointment.entity';
import { ScheduleBlock } from '../common/entities/schedule-block.entity';
import { TenantSchedule, WeeklyHours } from '../common/entities/tenant-schedule.entity';
import { ScheduleService } from '../schedule/schedule.service';
import { addDaysToDateStr, formatInTZ, TIME_RE, timeToMinutes } from '../common/utils/sp-time.util';
import { AvailabilityContext, AvailProfessional, computeDay, DayAvailability, isProfessionalFree, orderByPreference } from './agenda-availability';
import { AgendaNotifier } from './agenda-notifier';

const ACTIVE: AppointmentStatus[] = ['agendado', 'confirmado'];
const COLOR_RE = /^#[0-9a-f]{6}$/i;

export interface ProfessionalDto {
  name?: string;
  color?: string;
  whatsapp?: string | null;
  notify?: boolean;
  active?: boolean;
  sortOrder?: number;
  weeklyHours?: WeeklyHours;
  serviceIds?: string[];
}

export interface ServiceDto {
  name?: string;
  durationMinutes?: number;
  price?: number | null;
  priceNote?: string | null;
  active?: boolean;
  sortOrder?: number;
}

export interface BookInput {
  tenantId: string;
  serviceId: string;
  start: Date;
  professionalId?: string | null; // null/undefined = o sistema escolhe
  leadId?: string | null;
  clientName: string;
  clientPhone?: string | null;
  notes?: string | null;
  value?: number | null;
  source: 'ia' | 'manual';
  force?: boolean; // só manual: marca mesmo com conflito ("encaixe")
}

// Conflito ao marcar: carrega alternativas reais pra IA/tela oferecerem.
export class AgendaConflictError extends ConflictException {
  constructor(message: string, public readonly alternatives: { date: string; time: string }[]) {
    super({ message, alternatives });
  }
}

@Injectable()
export class AgendaService {
  constructor(
    @InjectRepository(AgendaProfessional) private readonly profRepo: Repository<AgendaProfessional>,
    @InjectRepository(AgendaServiceEntity) private readonly serviceRepo: Repository<AgendaServiceEntity>,
    @InjectRepository(AgendaProfessionalService) private readonly linkRepo: Repository<AgendaProfessionalService>,
    @InjectRepository(Appointment) private readonly apptRepo: Repository<Appointment>,
    @InjectRepository(ScheduleBlock) private readonly blockRepo: Repository<ScheduleBlock>,
    @InjectRepository(TenantSchedule) private readonly scheduleRepo: Repository<TenantSchedule>,
    private readonly scheduleService: ScheduleService,
    private readonly notifier: AgendaNotifier,
    private readonly dataSource: DataSource,
  ) {}

  // ───────── Configuração ─────────

  async isProMode(tenantId: string): Promise<boolean> {
    const s = await this.scheduleRepo.findOne({ where: { tenantId } });
    return s?.mode === 'professionals';
  }

  // Agenda nova ligada E a IA autorizada a agendar sozinha.
  async isAiBookingEnabled(tenantId: string): Promise<boolean> {
    const s = await this.scheduleRepo.findOne({ where: { tenantId } });
    return s?.mode === 'professionals' && s.enabled;
  }

  getSettings(tenantId: string) {
    return this.scheduleService.getSchedule(tenantId);
  }

  // Reaproveita a validação da agenda simples (horário do salão, grade, antecedência, janela).
  // `mode` só pode ser trocado por admin (controller decide).
  async updateSettings(tenantId: string, dto: { enabled?: boolean; slotMinutes?: number; bookingWindowDays?: number; minNoticeHours?: number; weeklyHours?: WeeklyHours; mode?: 'simple' | 'professionals' }) {
    if (dto.slotMinutes !== undefined && ![15, 30, 60].includes(dto.slotMinutes)) {
      throw new BadRequestException('Grade de horários deve ser 15, 30 ou 60 minutos');
    }
    const { mode, ...rest } = dto;
    const saved = await this.scheduleService.upsertSchedule(tenantId, rest);
    if (mode !== undefined) {
      if (!['simple', 'professionals'].includes(mode)) throw new BadRequestException('Modo inválido');
      saved.mode = mode;
      return this.scheduleRepo.save(saved);
    }
    return saved;
  }

  // ───────── Profissionais ─────────

  async listProfessionals(tenantId: string, includeInactive = true): Promise<AgendaProfessional[]> {
    const profs = await this.profRepo.find({ where: { tenantId, ...(includeInactive ? {} : { active: true }) }, order: { sortOrder: 'ASC', createdAt: 'ASC' } });
    if (!profs.length) return profs;
    const links = await this.linkRepo.find({ where: { professionalId: In(profs.map((p) => p.id)) } });
    for (const p of profs) p.serviceIds = links.filter((l) => l.professionalId === p.id).map((l) => l.serviceId);
    return profs;
  }

  async createProfessional(tenantId: string, dto: ProfessionalDto): Promise<AgendaProfessional> {
    if (!dto.name?.trim()) throw new BadRequestException('Nome do profissional é obrigatório');
    const count = await this.profRepo.count({ where: { tenantId } });
    const prof = this.profRepo.create({ tenantId, name: dto.name.trim(), sortOrder: count, weeklyHours: {} });
    return this.saveProfessional(tenantId, prof, dto);
  }

  async updateProfessional(tenantId: string, id: string, dto: ProfessionalDto): Promise<AgendaProfessional> {
    const prof = await this.profRepo.findOne({ where: { id, tenantId } });
    if (!prof) throw new NotFoundException('Profissional não encontrado');
    return this.saveProfessional(tenantId, prof, dto);
  }

  private async saveProfessional(tenantId: string, prof: AgendaProfessional, dto: ProfessionalDto): Promise<AgendaProfessional> {
    if (dto.name !== undefined) {
      if (!dto.name.trim()) throw new BadRequestException('Nome do profissional é obrigatório');
      prof.name = dto.name.trim();
    }
    if (dto.color !== undefined) {
      if (!COLOR_RE.test(dto.color)) throw new BadRequestException('Cor inválida');
      prof.color = dto.color;
    }
    if (dto.whatsapp !== undefined) {
      const digits = (dto.whatsapp ?? '').replace(/\D/g, '');
      if (digits && (digits.length < 10 || digits.length > 13)) throw new BadRequestException('WhatsApp inválido (use DDD + número)');
      prof.whatsapp = digits || null;
    }
    if (dto.notify !== undefined) prof.notify = !!dto.notify;
    if (dto.active !== undefined) prof.active = !!dto.active;
    if (dto.sortOrder !== undefined) prof.sortOrder = Number(dto.sortOrder) || 0;
    if (dto.weeklyHours !== undefined) prof.weeklyHours = validateWeeklyHours(dto.weeklyHours);
    const saved = await this.profRepo.save(prof);

    if (dto.serviceIds !== undefined) {
      const valid = await this.serviceRepo.find({ where: { tenantId, id: In(dto.serviceIds.length ? dto.serviceIds : ['00000000-0000-0000-0000-000000000000']) } });
      await this.linkRepo.delete({ professionalId: saved.id });
      if (valid.length) await this.linkRepo.save(valid.map((s) => ({ professionalId: saved.id, serviceId: s.id })));
    }
    const links = await this.linkRepo.find({ where: { professionalId: saved.id } });
    saved.serviceIds = links.map((l) => l.serviceId);
    return saved;
  }

  // Excluir de verdade apagaria o histórico dos agendamentos — desativa.
  async deactivateProfessional(tenantId: string, id: string): Promise<void> {
    const r = await this.profRepo.update({ id, tenantId }, { active: false });
    if (!r.affected) throw new NotFoundException('Profissional não encontrado');
  }

  // ───────── Serviços ─────────

  listServices(tenantId: string, includeInactive = true): Promise<AgendaServiceEntity[]> {
    return this.serviceRepo.find({ where: { tenantId, ...(includeInactive ? {} : { active: true }) }, order: { sortOrder: 'ASC', createdAt: 'ASC' } });
  }

  async createService(tenantId: string, dto: ServiceDto): Promise<AgendaServiceEntity> {
    if (!dto.name?.trim()) throw new BadRequestException('Nome do serviço é obrigatório');
    const count = await this.serviceRepo.count({ where: { tenantId } });
    const svc = this.serviceRepo.create({ tenantId, name: dto.name.trim(), durationMinutes: 60, sortOrder: count });
    return this.saveService(svc, dto);
  }

  async updateService(tenantId: string, id: string, dto: ServiceDto): Promise<AgendaServiceEntity> {
    const svc = await this.serviceRepo.findOne({ where: { id, tenantId } });
    if (!svc) throw new NotFoundException('Serviço não encontrado');
    return this.saveService(svc, dto);
  }

  private saveService(svc: AgendaServiceEntity, dto: ServiceDto): Promise<AgendaServiceEntity> {
    if (dto.name !== undefined) {
      if (!dto.name.trim()) throw new BadRequestException('Nome do serviço é obrigatório');
      svc.name = dto.name.trim();
    }
    if (dto.durationMinutes !== undefined) {
      const d = Number(dto.durationMinutes);
      if (!Number.isInteger(d) || d < 15 || d > 720 || d % 15 !== 0) throw new BadRequestException('Duração deve ser de 15 em 15 minutos (até 12 horas)');
      svc.durationMinutes = d;
    }
    if (dto.price !== undefined) {
      if (dto.price === null || (dto.price as any) === '') svc.price = null;
      else {
        const p = Number(dto.price);
        if (!Number.isFinite(p) || p < 0) throw new BadRequestException('Preço inválido');
        svc.price = p.toFixed(2);
      }
    }
    if (dto.priceNote !== undefined) svc.priceNote = dto.priceNote?.trim() || null;
    if (dto.active !== undefined) svc.active = !!dto.active;
    if (dto.sortOrder !== undefined) svc.sortOrder = Number(dto.sortOrder) || 0;
    return this.serviceRepo.save(svc);
  }

  async deactivateService(tenantId: string, id: string): Promise<void> {
    const r = await this.serviceRepo.update({ id, tenantId }, { active: false });
    if (!r.affected) throw new NotFoundException('Serviço não encontrado');
  }

  // ───────── Bloqueios ─────────

  listBlocks(tenantId: string, from?: Date, to?: Date): Promise<ScheduleBlock[]> {
    const qb = this.blockRepo.createQueryBuilder('b').where('b.tenant_id = :tenantId', { tenantId });
    if (from) qb.andWhere('b.end_date_time > :from', { from });
    if (to) qb.andWhere('b.start_date_time < :to', { to });
    return qb.orderBy('b.start_date_time', 'ASC').getMany();
  }

  async createBlock(tenantId: string, dto: { startDateTime: string; endDateTime: string; reason?: string | null; professionalId?: string | null }): Promise<ScheduleBlock> {
    const start = new Date(dto.startDateTime);
    const end = new Date(dto.endDateTime);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || !(start < end)) throw new BadRequestException('O início do bloqueio deve ser antes do fim');
    if (dto.professionalId) {
      const p = await this.profRepo.findOne({ where: { id: dto.professionalId, tenantId } });
      if (!p) throw new NotFoundException('Profissional não encontrado');
    }
    return this.blockRepo.save(this.blockRepo.create({ tenantId, startDateTime: start, endDateTime: end, reason: dto.reason?.trim() || null, professionalId: dto.professionalId || null }));
  }

  async deleteBlock(tenantId: string, id: string): Promise<void> {
    const r = await this.blockRepo.delete({ id, tenantId });
    if (!r.affected) throw new NotFoundException('Bloqueio não encontrado');
  }

  // ───────── Agendamentos ─────────

  listAppointments(tenantId: string, from: Date, to: Date): Promise<Appointment[]> {
    return this.apptRepo.find({ where: { tenantId, startDateTime: Between(from, to) }, order: { startDateTime: 'ASC' }, relations: ['lead'] });
  }

  // Monta o contexto de disponibilidade a partir do banco (ou de um EntityManager de transação).
  private async loadContext(tenantId: string, from: Date, to: Date, manager?: EntityManager, ignoreAppointmentId?: string): Promise<{ ctx: AvailabilityContext; schedule: TenantSchedule; profs: AgendaProfessional[] }> {
    const m = manager ?? this.dataSource.manager;
    const schedule = (await m.findOne(TenantSchedule, { where: { tenantId } })) ?? (await this.scheduleService.getSchedule(tenantId));
    const profs = await m.find(AgendaProfessional, { where: { tenantId, active: true }, order: { sortOrder: 'ASC' } });
    const links = profs.length ? await m.find(AgendaProfessionalService, { where: { professionalId: In(profs.map((p) => p.id)) } }) : [];
    const services = await m.find(AgendaServiceEntity, { where: { tenantId, active: true } });
    const activeServiceIds = new Set(services.map((s) => s.id));
    const appts = await m.createQueryBuilder(Appointment, 'a')
      .where('a.tenant_id = :tenantId', { tenantId })
      .andWhere('a.status IN (:...st)', { st: ACTIVE })
      .andWhere('a.professional_id IS NOT NULL')
      .andWhere('a.start_date_time < :to', { to })
      .andWhere('COALESCE(a.end_date_time, a.start_date_time) > :from', { from })
      .getMany();
    const blocks = await m.createQueryBuilder(ScheduleBlock, 'b')
      .where('b.tenant_id = :tenantId', { tenantId })
      .andWhere('b.start_date_time < :to', { to })
      .andWhere('b.end_date_time > :from', { from })
      .getMany();
    const availProfs: AvailProfessional[] = profs.map((p) => ({
      id: p.id,
      sortOrder: p.sortOrder,
      weeklyHours: p.weeklyHours ?? {},
      serviceIds: links.filter((l) => l.professionalId === p.id && activeServiceIds.has(l.serviceId)).map((l) => l.serviceId),
    }));
    const ctx: AvailabilityContext = {
      professionals: availProfs,
      salonHours: schedule.weeklyHours ?? {},
      gridMinutes: schedule.slotMinutes || 30,
      earliest: new Date(Date.now() + (schedule.minNoticeHours ?? 0) * 3600 * 1000),
      appointments: appts
        .filter((a) => a.id !== ignoreAppointmentId)
        .map((a) => ({ professionalId: a.professionalId, start: a.startDateTime, end: a.endDateTime ?? new Date(a.startDateTime.getTime() + 60 * 60000) })),
      blocks: blocks.map((b) => ({ professionalId: b.professionalId, start: b.startDateTime, end: b.endDateTime })),
    };
    return { ctx, schedule, profs };
  }

  private async getService(tenantId: string, serviceId: string, manager?: EntityManager): Promise<AgendaServiceEntity> {
    const m = manager ?? this.dataSource.manager;
    const svc = await m.findOne(AgendaServiceEntity, { where: { id: serviceId, tenantId } });
    if (!svc || !svc.active) throw new NotFoundException('Serviço não encontrado');
    return svc;
  }

  // Horários livres dia a dia (a partir de `fromDate`, dentro da janela de agendamento).
  async getSlots(tenantId: string, serviceId: string, fromDate?: string, days?: number): Promise<DayAvailability[]> {
    const svc = await this.getService(tenantId, serviceId);
    const schedule = await this.scheduleService.getSchedule(tenantId);
    const today = formatInTZ(new Date()).date;
    const start = fromDate && fromDate > today ? fromDate : today;
    const lastAllowed = addDaysToDateStr(today, schedule.bookingWindowDays ?? 14);
    const n = Math.max(1, Math.min(days ?? 7, 31));
    const dates: string[] = [];
    for (let i = 0; i < n; i++) {
      const d = addDaysToDateStr(start, i);
      if (d > lastAllowed) break;
      dates.push(d);
    }
    if (!dates.length) return [];
    const from = new Date(`${dates[0]}T00:00:00-03:00`);
    const to = new Date(`${addDaysToDateStr(dates[dates.length - 1], 1)}T00:00:00-03:00`);
    const { ctx } = await this.loadContext(tenantId, from, to);
    return dates.map((d) => computeDay(ctx, svc.id, svc.durationMinutes, d));
  }

  // Próximos horários livres (pra oferecer alternativa quando o escolhido não dá).
  async nextAvailable(tenantId: string, serviceId: string, count = 3, fromDate?: string): Promise<{ date: string; time: string }[]> {
    const days = await this.getSlots(tenantId, serviceId, fromDate, 14);
    const out: { date: string; time: string }[] = [];
    for (const d of days) for (const s of d.slots) {
      out.push({ date: d.date, time: s.time });
      if (out.length >= count) return out;
    }
    return out;
  }

  // Marca um horário. Transação + advisory lock por tenant: a IA e a recepção nunca pegam o
  // mesmo horário do mesmo profissional, mesmo marcando ao mesmo tempo.
  async book(input: BookInput): Promise<Appointment> {
    if (!(input.start instanceof Date) || isNaN(input.start.getTime())) throw new BadRequestException('Data/hora inválida');
    if (!input.clientName?.trim()) throw new BadRequestException('Nome da cliente é obrigatório');
    const appt = await this.dataSource.transaction(async (m) => {
      await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [input.tenantId]);
      const svc = await this.getService(input.tenantId, input.serviceId, m);
      const professionalId = await this.resolveProfessional(input.tenantId, svc, input.start, input.professionalId ?? null, !!input.force, m);
      const end = new Date(input.start.getTime() + svc.durationMinutes * 60000);
      return m.save(Appointment, m.create(Appointment, {
        tenantId: input.tenantId,
        leadId: input.leadId ?? null,
        clientName: input.clientName.trim(),
        clientPhone: input.clientPhone?.replace(/\D/g, '') || null,
        service: svc.name,
        serviceId: svc.id,
        professionalId,
        value: input.value ?? (svc.price !== null ? Number(svc.price) : null),
        status: 'confirmado',
        startDateTime: input.start,
        endDateTime: end,
        notes: input.notes?.trim() || null,
        source: input.source,
      }));
    });
    void this.notifier.notify('novo', appt);
    return appt;
  }

  // Remarca (data/hora, profissional e/ou serviço) com a mesma trava do book().
  async reschedule(tenantId: string, appointmentId: string, change: { start?: Date; professionalId?: string | null; serviceId?: string }, opts: { force?: boolean; source: 'ia' | 'manual' }): Promise<Appointment> {
    let previousStart: Date | null = null;
    const appt = await this.dataSource.transaction(async (m) => {
      await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [tenantId]);
      const current = await m.findOne(Appointment, { where: { id: appointmentId, tenantId } });
      if (!current) throw new NotFoundException('Agendamento não encontrado');
      if (!ACTIVE.includes(current.status)) throw new BadRequestException('Só dá pra remarcar agendamento ativo');
      if (!current.serviceId && !change.serviceId) throw new BadRequestException('Agendamento sem serviço da agenda');
      previousStart = current.startDateTime;
      const svc = await this.getService(tenantId, change.serviceId ?? current.serviceId!, m);
      const start = change.start ?? current.startDateTime;
      const wanted = change.professionalId === undefined ? current.professionalId : change.professionalId;
      const professionalId = await this.resolveProfessional(tenantId, svc, start, wanted, !!opts.force, m, current.id);
      Object.assign(current, {
        startDateTime: start,
        endDateTime: new Date(start.getTime() + svc.durationMinutes * 60000),
        professionalId,
        serviceId: svc.id,
        service: svc.name,
        reminderSentAt: null, // horário novo → lembrete novo
      });
      return m.save(Appointment, current);
    });
    void this.notifier.notify('remarcado', appt, { previousStart, source: opts.source });
    return appt;
  }

  async cancel(tenantId: string, appointmentId: string, source: 'ia' | 'manual'): Promise<Appointment> {
    const appt = await this.apptRepo.findOne({ where: { id: appointmentId, tenantId } });
    if (!appt) throw new NotFoundException('Agendamento não encontrado');
    if (appt.status === 'cancelado') return appt;
    appt.status = 'cancelado';
    const saved = await this.apptRepo.save(appt);
    void this.notifier.notify('cancelado', saved, { source });
    return saved;
  }

  async setStatus(tenantId: string, appointmentId: string, status: AppointmentStatus): Promise<Appointment> {
    if (status === 'cancelado') return this.cancel(tenantId, appointmentId, 'manual');
    if (!['confirmado', 'realizado', 'nao_compareceu'].includes(status)) throw new BadRequestException('Status inválido');
    const appt = await this.apptRepo.findOne({ where: { id: appointmentId, tenantId } });
    if (!appt) throw new NotFoundException('Agendamento não encontrado');
    appt.status = status;
    return this.apptRepo.save(appt);
  }

  async updateNotes(tenantId: string, appointmentId: string, notes: string | null, value?: number | null): Promise<Appointment> {
    const appt = await this.apptRepo.findOne({ where: { id: appointmentId, tenantId } });
    if (!appt) throw new NotFoundException('Agendamento não encontrado');
    appt.notes = notes?.trim() || null;
    if (value !== undefined) appt.value = value;
    return this.apptRepo.save(appt);
  }

  // Próximo agendamento ativo da cliente (pra IA remarcar/cancelar).
  nextActiveForLead(tenantId: string, leadId: string): Promise<Appointment | null> {
    return this.apptRepo.createQueryBuilder('a')
      .where('a.tenant_id = :tenantId', { tenantId })
      .andWhere('a.lead_id = :leadId', { leadId })
      .andWhere('a.status IN (:...st)', { st: ACTIVE })
      .andWhere('a.service_id IS NOT NULL')
      .andWhere('a.start_date_time > now()')
      .orderBy('a.start_date_time', 'ASC')
      .getOne();
  }

  // Valida/escolhe o profissional dentro da transação. Sem profissional pedido → o sistema
  // escolhe entre os livres. Conflito → AgendaConflictError com alternativas (salvo `force`).
  private async resolveProfessional(tenantId: string, svc: AgendaServiceEntity, start: Date, wanted: string | null, force: boolean, m: EntityManager, ignoreAppointmentId?: string): Promise<string> {
    const dayFrom = new Date(start.getTime() - 24 * 3600 * 1000);
    const dayTo = new Date(start.getTime() + 24 * 3600 * 1000 + svc.durationMinutes * 60000);
    const { ctx } = await this.loadContext(tenantId, dayFrom, dayTo, m, ignoreAppointmentId);
    const able = ctx.professionals.filter((p) => p.serviceIds.includes(svc.id));
    if (!able.length) throw new BadRequestException(`Nenhum profissional ativo faz "${svc.name}"`);

    if (wanted) {
      const p = able.find((x) => x.id === wanted);
      if (!p) throw new BadRequestException('Esse profissional não faz esse serviço');
      if (force || isProfessionalFree(ctx, p, start, svc.durationMinutes)) return p.id;
      throw new AgendaConflictError('Esse profissional já tem atendimento nesse horário', await this.alternativesFrom(tenantId, svc.id, start));
    }
    const free = able.filter((p) => isProfessionalFree(ctx, p, start, svc.durationMinutes)).map((p) => p.id);
    if (free.length) return orderByPreference(ctx, free, formatInTZ(start).date)[0];
    if (force) return orderByPreference(ctx, able.map((p) => p.id), formatInTZ(start).date)[0];
    throw new AgendaConflictError('Esse horário não está mais livre', await this.alternativesFrom(tenantId, svc.id, start));
  }

  // Alternativas pra um horário que não deu: primeiro as mais próximas do horário pedido no
  // mesmo dia, depois os próximos dias com vaga.
  private async alternativesFrom(tenantId: string, serviceId: string, start: Date) {
    try {
      const civil = formatInTZ(start);
      const wanted = civil.hour * 60 + civil.minute;
      const days = await this.getSlots(tenantId, serviceId, civil.date, 14);
      const sameDay = (days.find((d) => d.date === civil.date)?.slots ?? [])
        .map((s) => ({ date: civil.date, time: s.time, dist: Math.abs(timeToMinutes(s.time) - wanted) }))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 3)
        .sort((a, b) => a.time.localeCompare(b.time))
        .map(({ date, time }) => ({ date, time }));
      const later = days.filter((d) => d.date > civil.date).flatMap((d) => d.slots.map((s) => ({ date: d.date, time: s.time })));
      return [...sameDay, ...later].slice(0, 3);
    } catch {
      return [];
    }
  }
}

function validateWeeklyHours(weeklyHours: WeeklyHours): WeeklyHours {
  const cleaned: WeeklyHours = {};
  for (const [day, intervals] of Object.entries(weeklyHours ?? {})) {
    const n = Number(day);
    if (!Number.isInteger(n) || n < 0 || n > 6) throw new BadRequestException(`Dia da semana inválido: ${day}`);
    if (!Array.isArray(intervals) || !intervals.length) continue;
    const sorted = [...intervals].sort((a, b) => a.start.localeCompare(b.start));
    let prevEnd = -1;
    for (const iv of sorted) {
      if (!TIME_RE.test(iv.start) || !TIME_RE.test(iv.end)) throw new BadRequestException(`Horário inválido no dia ${day}`);
      const s = timeToMinutes(iv.start);
      const e = timeToMinutes(iv.end);
      if (s >= e) throw new BadRequestException(`Intervalo inválido no dia ${day}: início deve ser antes do fim`);
      if (s < prevEnd) throw new BadRequestException(`Intervalos sobrepostos no dia ${day}`);
      prevEnd = e;
    }
    cleaned[day] = sorted.map((iv) => ({ start: iv.start, end: iv.end }));
  }
  return cleaned;
}
