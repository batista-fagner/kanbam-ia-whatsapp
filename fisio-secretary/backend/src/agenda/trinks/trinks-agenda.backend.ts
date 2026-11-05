import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Appointment } from '../../common/entities/appointment.entity';
import { AgendaServiceEntity } from '../../common/entities/agenda-service.entity';
import { TenantSchedule } from '../../common/entities/tenant-schedule.entity';
import type { Lead } from '../../common/entities/lead.entity';
import type { TrinksCatalog } from '../../common/entities/agenda-integration.entity';
import { addDaysToDateStr, DAY_NAMES_SHORT, formatInTZ, timeToMinutes, toSPDate, weekdayOfDateStr } from '../../common/utils/sp-time.util';
import { followupTriggers } from '../../common/followup-triggers';
import { externalAppointmentCheck } from '../../common/external-appointment-check';
import { AgendaConflictError } from '../agenda.service';
import { samePhone, splitBrazilPhone, TRINKS_ACTIVE_STATUS, TRINKS_STATUS, TrinksApiError, TrinksAppointment, TrinksClient } from './trinks.client';
import { TrinksIntegrationService } from './trinks-integration.service';

const ACTIVE_LOCAL = ['agendado', 'confirmado'] as const;
const CACHE_TTL_MS = 3 * 60 * 1000;
const MAX_DAYS_FETCHED = 7;

export interface TrinksDay {
  date: string;
  weekday: string;
  slots: { time: string; professionalIds: number[]; freeCount: Record<number, number> }[];
}

export interface TrinksBookInput {
  tenantId: string;
  service: AgendaServiceEntity; // local, ligado e aprovado
  start: Date;
  lead: Lead;
  clientName: string;
}

// "2026-11-06T10:30:00" (local da Trinks, sem fuso) ↔ Date.
export function fromTrinksLocal(s: string): Date {
  return new Date(`${s.slice(0, 19)}-03:00`);
}
export function toTrinksLocal(d: Date): string {
  const c = formatInTZ(d);
  return `${c.date}T${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}:00`;
}

// Junta os horários vagos de todos os profissionais que fazem o serviço. `freeCount` = quantos
// horários vagos o profissional tem no dia (proxy de carga — mais vagas = menos ocupado).
export function unionSlots(
  date: string,
  profs: { id: number; horariosVagos: string[] }[],
  ableIds: Set<number>,
  earliest: Date,
): TrinksDay {
  const byTime = new Map<string, number[]>();
  const freeCount: Record<number, number> = {};
  for (const p of profs) {
    if (!ableIds.has(p.id)) continue;
    const times = (p.horariosVagos ?? []).filter((t) => /^\d{2}:\d{2}$/.test(t) && toSPDate(date, t) >= earliest);
    freeCount[p.id] = times.length;
    for (const t of times) byTime.set(t, [...(byTime.get(t) ?? []), p.id]);
  }
  const slots = [...byTime.entries()]
    .sort((a, b) => timeToMinutes(a[0]) - timeToMinutes(b[0]))
    .map(([time, ids]) => ({ time, professionalIds: ids, freeCount }));
  return { date, weekday: DAY_NAMES_SHORT[weekdayOfDateStr(date)], slots };
}

// Entre os livres no horário, o que tem mais horários vagos no dia; empate → ordem do catálogo.
export function pickTrinksProfessional(ids: number[], freeCount: Record<number, number>, order: number[]): number {
  return [...ids].sort((a, b) => (freeCount[b] ?? 0) - (freeCount[a] ?? 0) || order.indexOf(a) - order.indexOf(b))[0];
}

export function ableProfessionalIds(catalog: TrinksCatalog | null, externalServiceId: number): Set<number> {
  return new Set((catalog?.professionals ?? []).filter((p) => Array.isArray(p.serviceIds) && p.serviceIds.includes(externalServiceId)).map((p) => p.id));
}

// Agenda da Trinks para a IA: consulta horários, grava, remarca e cancela lá, mantendo uma
// cópia local em `appointments` (lembrete, card do lead, histórico). Não chama o AgendaNotifier:
// o aviso ao profissional fica com a própria Trinks.
@Injectable()
export class TrinksAgendaBackend implements OnModuleInit {
  private readonly logger = new Logger('TrinksAgenda');
  private readonly cache = new Map<string, { at: number; profs: { id: number; nome: string; horariosVagos: string[] }[] }>();

  constructor(
    private readonly integration: TrinksIntegrationService,
    @InjectRepository(Appointment) private readonly apptRepo: Repository<Appointment>,
    @InjectRepository(AgendaServiceEntity) private readonly serviceRepo: Repository<AgendaServiceEntity>,
    @InjectRepository(TenantSchedule) private readonly scheduleRepo: Repository<TenantSchedule>,
    private readonly dataSource: DataSource,
  ) {}

  onModuleInit() {
    // Lembrete: antes de mandar, confere na Trinks se o agendamento ainda vale.
    externalAppointmentCheck.register('trinks', (appt) => this.stillActive(appt));
  }

  async schedule(tenantId: string): Promise<TenantSchedule | null> {
    return this.scheduleRepo.findOne({ where: { tenantId } });
  }

  // ───────── Horários ─────────

  private async dayFromTrinks(tenantId: string, client: TrinksClient, extServiceId: number, date: string, live: boolean) {
    const key = `${tenantId}|${extServiceId}|${date}`;
    const hit = this.cache.get(key);
    if (!live && hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.profs;
    const profs = await client.availability(date, extServiceId);
    this.cache.set(key, { at: Date.now(), profs });
    if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value as string);
    return profs;
  }

  // Dia pedido + próximos dias até juntar dias com vaga suficientes (economiza cota).
  async fetchDays(tenantId: string, service: AgendaServiceEntity, fromDate: string, opts: { live?: boolean; maxDays?: number } = {}): Promise<TrinksDay[]> {
    if (!service.externalId) throw new TrinksApiError(400, `Serviço "${service.name}" sem ligação com a Trinks`);
    const { client, integration } = await this.integration.clientFor(tenantId);
    const schedule = await this.schedule(tenantId);
    const able = ableProfessionalIds(integration.catalog, Number(service.externalId));
    const today = formatInTZ(new Date()).date;
    const start = fromDate > today ? fromDate : today;
    const lastAllowed = addDaysToDateStr(today, schedule?.bookingWindowDays ?? 14);
    const earliest = new Date(Date.now() + (schedule?.minNoticeHours ?? 0) * 3600 * 1000);
    const maxDays = opts.maxDays ?? MAX_DAYS_FETCHED;
    const out: TrinksDay[] = [];
    for (let i = 0; i < maxDays; i++) {
      const date = addDaysToDateStr(start, i);
      if (date > lastAllowed) break;
      const profs = able.size ? await this.dayFromTrinks(tenantId, client, Number(service.externalId), date, !!opts.live) : [];
      out.push(unionSlots(date, profs, able, earliest));
      const withSlots = out.filter((d) => d.slots.length).length;
      // Dia pedido com vaga: ele + 1 dia de alternativa. Sem vaga: até 3 dias com vaga.
      if ((out[0].slots.length && withSlots >= 2) || withSlots >= 3) break;
    }
    return out;
  }

  // ───────── Agendamento atual ─────────

  // Cópia local (sem gastar cota) — usada no bloco do prompt a cada mensagem.
  currentMirror(tenantId: string, leadId: string): Promise<Appointment | null> {
    return this.apptRepo.createQueryBuilder('a')
      .where('a.tenant_id = :tenantId', { tenantId })
      .andWhere('a.lead_id = :leadId', { leadId })
      .andWhere("a.external_provider = 'trinks'")
      .andWhere('a.status IN (:...st)', { st: ACTIVE_LOCAL })
      .andWhere('a.start_date_time > now()')
      .orderBy('a.start_date_time', 'ASC')
      .getOne();
  }

  // Agendamento ativo da cliente conferido NA TRINKS (pega também o que a recepção marcou lá
  // e percebe se o salão já cancelou). Usado antes de remarcar/cancelar.
  async resolveActive(tenantId: string, lead: Lead): Promise<Appointment | null> {
    const { client, integration } = await this.integration.clientFor(tenantId);
    const mirror = await this.currentMirror(tenantId, lead.id);
    if (mirror?.externalId) {
      const remote = await client.getAppointment(mirror.externalId).catch((err) => {
        if (err instanceof TrinksApiError && err.status === 404) return null;
        throw err;
      });
      if (remote && TRINKS_ACTIVE_STATUS.includes(remote.status?.id ?? -1)) return this.syncMirror(mirror, remote, integration.catalog);
      await this.apptRepo.update({ id: mirror.id }, { status: remote?.status?.id === TRINKS_STATUS.finalizado ? 'realizado' : 'cancelado' });
    }
    // Procura na Trinks pelo telefone (agendamento feito pela recepção, sem cópia aqui).
    const clientId = mirror?.externalClientId ?? (await this.findClientId(client, lead.phone));
    if (!clientId) return null;
    const today = formatInTZ(new Date()).date;
    const list = await client.listClientAppointments(clientId, today, addDaysToDateStr(today, 90));
    const next = list
      .filter((a) => TRINKS_ACTIVE_STATUS.includes(a.status?.id ?? -1) && fromTrinksLocal(a.dataHoraInicio) > new Date())
      .sort((a, b) => a.dataHoraInicio.localeCompare(b.dataHoraInicio))[0];
    if (!next) return null;
    const existing = await this.apptRepo.findOne({ where: { tenantId, externalProvider: 'trinks', externalId: String(next.id) } });
    if (existing) return this.syncMirror(existing, next, integration.catalog);
    const local = next.servico ? await this.serviceRepo.findOne({ where: { tenantId, externalId: String(next.servico.id) } }) : null;
    const start = fromTrinksLocal(next.dataHoraInicio);
    return this.apptRepo.save(this.apptRepo.create({
      tenantId,
      leadId: lead.id,
      clientName: next.cliente?.nome || lead.name || lead.phone,
      clientPhone: lead.phone?.replace(/\D/g, '') || null,
      service: local?.name ?? next.servico?.nome ?? 'Serviço',
      serviceId: local?.id ?? null,
      value: next.valor ?? null,
      status: next.status?.id === TRINKS_STATUS.confirmado ? 'confirmado' : 'agendado',
      startDateTime: start,
      endDateTime: new Date(start.getTime() + (next.duracaoEmMinutos || 60) * 60000),
      notes: 'Marcado direto na Trinks (copiado pela IA ao remarcar/cancelar)',
      source: 'manual',
      externalProvider: 'trinks',
      externalId: String(next.id),
      externalClientId: String(clientId),
      externalProfessionalId: next.profissional ? String(next.profissional.id) : null,
      externalProfessionalName: next.profissional?.nome ?? null,
    }));
  }

  // A recepção pode ter mudado horário/profissional direto na Trinks — a cópia acompanha.
  private async syncMirror(mirror: Appointment, remote: TrinksAppointment, catalog: TrinksCatalog | null): Promise<Appointment> {
    const start = fromTrinksLocal(remote.dataHoraInicio);
    const changed = start.getTime() !== mirror.startDateTime.getTime() || String(remote.profissional?.id ?? '') !== String(mirror.externalProfessionalId ?? '');
    if (!changed) return mirror;
    mirror.startDateTime = start;
    mirror.endDateTime = new Date(start.getTime() + (remote.duracaoEmMinutos || 60) * 60000);
    mirror.externalProfessionalId = remote.profissional ? String(remote.profissional.id) : null;
    mirror.externalProfessionalName = remote.profissional?.nome ?? catalog?.professionals.find((p) => String(p.id) === mirror.externalProfessionalId)?.nome ?? null;
    mirror.reminderSentAt = null;
    const saved = await this.apptRepo.save(mirror);
    followupTriggers.emit({ kind: 'appointment', appointmentId: saved.id });
    return saved;
  }

  // ───────── Gravar ─────────

  async book(input: TrinksBookInput): Promise<Appointment> {
    const { tenantId, service, start, lead } = input;
    if (!service.externalId) throw new TrinksApiError(400, `Serviço "${service.name}" sem ligação com a Trinks`);
    // Mesmo pedido gravado há pouco (reentrega/clique duplo) → devolve o mesmo, nunca grava 2x.
    const dup = await this.apptRepo.findOne({ where: { tenantId, leadId: lead.id, externalProvider: 'trinks', serviceId: service.id, startDateTime: start, status: In([...ACTIVE_LOCAL]) } });
    if (dup) return dup;

    const { client, integration } = await this.integration.clientFor(tenantId);
    const chosen = await this.freeProfessionalAt(tenantId, client, integration.catalog, service, start);
    const clientId = await this.findOrCreateClient(client, lead, input.clientName);
    const ext = integration.catalog?.services.find((s) => String(s.id) === service.externalId);
    const duration = ext?.duracaoEmMinutos || service.externalDurationMinutes || service.durationMinutes;
    const valor = Math.max(0, Number(ext?.preco ?? 0) || 0);
    const said = await this.lastInboundText(lead.id);
    const stamp = toTrinksLocal(new Date()).slice(0, 16).replace('T', ' ');
    const observacoes = `Agendado pela IA do WhatsApp em ${stamp}${said ? ` — cliente confirmou: "${said.slice(0, 120)}"` : ''}`;

    const externalId = await client.createAppointment({
      clienteId: clientId,
      servicoId: Number(service.externalId),
      profissionalId: chosen.id,
      dataHoraInicio: toTrinksLocal(start),
      duracaoEmMinutos: duration,
      valor,
      observacoes,
      confirmado: integration.autoConfirm,
    });
    this.cache.clear();
    const appt = await this.apptRepo.save(this.apptRepo.create({
      tenantId,
      leadId: lead.id,
      clientName: input.clientName,
      clientPhone: lead.phone?.replace(/\D/g, '') || null,
      service: service.name,
      serviceId: service.id,
      value: valor,
      status: integration.autoConfirm ? 'confirmado' : 'agendado',
      startDateTime: start,
      endDateTime: new Date(start.getTime() + duration * 60000),
      notes: observacoes,
      source: 'ia',
      externalProvider: 'trinks',
      externalId: String(externalId),
      externalClientId: String(clientId),
      externalProfessionalId: String(chosen.id),
      externalProfessionalName: chosen.nome,
    }));
    followupTriggers.emit({ kind: 'appointment', appointmentId: appt.id });
    this.logger.log(`[TRINKS] Agendado ${externalId} — ${service.name} ${toTrinksLocal(start)} com ${chosen.id} (tenant ${tenantId}, lead ${lead.id})`);
    return appt;
  }

  async reschedule(tenantId: string, mirror: Appointment, start: Date, service: AgendaServiceEntity | null): Promise<Appointment> {
    if (!mirror.externalId) throw new TrinksApiError(400, 'Agendamento sem id da Trinks');
    const { client, integration } = await this.integration.clientFor(tenantId);
    const remote = await client.getAppointment(mirror.externalId);
    if (!TRINKS_ACTIVE_STATUS.includes(remote.status?.id ?? -1)) throw new TrinksApiError(400, 'Esse agendamento não está mais ativo na Trinks');
    const extServiceId = service?.externalId ? Number(service.externalId) : remote.servico?.id;
    if (!extServiceId) throw new TrinksApiError(400, 'Serviço do agendamento desconhecido');
    const ext = integration.catalog?.services.find((s) => s.id === extServiceId);
    const duration = service ? ext?.duracaoEmMinutos || service.externalDurationMinutes || remote.duracaoEmMinutos : remote.duracaoEmMinutos;
    const svcForCheck = service ?? ({ name: mirror.service, externalId: String(extServiceId) } as AgendaServiceEntity);
    const chosen = await this.freeProfessionalAt(tenantId, client, integration.catalog, svcForCheck, start);
    const stamp = toTrinksLocal(new Date()).slice(0, 16).replace('T', ' ');
    const observacoes = [remote.observacoesDoEstabelecimento, `Remarcado pela IA do WhatsApp em ${stamp} (antes: ${remote.dataHoraInicio.slice(0, 16).replace('T', ' ')})`].filter(Boolean).join(' | ').slice(0, 1000);
    await client.updateAppointment(mirror.externalId, {
      clienteId: remote.cliente?.id ?? Number(mirror.externalClientId),
      servicoId: extServiceId,
      profissionalId: chosen.id,
      dataHoraInicio: toTrinksLocal(start),
      duracaoEmMinutos: duration,
      valor: remote.valor ?? Number(mirror.value ?? 0),
      observacoes,
    });
    this.cache.clear();
    Object.assign(mirror, {
      startDateTime: start,
      endDateTime: new Date(start.getTime() + duration * 60000),
      serviceId: service?.id ?? mirror.serviceId,
      service: service?.name ?? mirror.service,
      externalProfessionalId: String(chosen.id),
      externalProfessionalName: chosen.nome,
      notes: observacoes,
      reminderSentAt: null,
    });
    const saved = await this.apptRepo.save(mirror);
    followupTriggers.emit({ kind: 'appointment', appointmentId: saved.id });
    this.logger.log(`[TRINKS] Remarcado ${mirror.externalId} → ${toTrinksLocal(start)} (tenant ${tenantId})`);
    return saved;
  }

  async cancel(tenantId: string, mirror: Appointment): Promise<Appointment> {
    if (!mirror.externalId) throw new TrinksApiError(400, 'Agendamento sem id da Trinks');
    const { client } = await this.integration.clientFor(tenantId);
    await client.cancelAppointment(mirror.externalId, 'Cancelado pela cliente pelo WhatsApp (IA)');
    this.cache.clear();
    mirror.status = 'cancelado';
    const saved = await this.apptRepo.save(mirror);
    this.logger.log(`[TRINKS] Cancelado ${mirror.externalId} (tenant ${tenantId})`);
    return saved;
  }

  // Reconsulta o dia AO VIVO e escolhe quem está livre no horário. Vaga sumiu → conflito com
  // alternativas reais (a Trinks não barra horário duplicado — quem barra somos nós).
  private async freeProfessionalAt(tenantId: string, client: TrinksClient, catalog: TrinksCatalog | null, service: AgendaServiceEntity, start: Date): Promise<{ id: number; nome: string }> {
    const extId = Number(service.externalId);
    const able = ableProfessionalIds(catalog, extId);
    if (!able.size) throw new TrinksApiError(400, `Nenhum profissional faz "${service.name}" na Trinks`);
    const civil = formatInTZ(start);
    const time = `${String(civil.hour).padStart(2, '0')}:${String(civil.minute).padStart(2, '0')}`;
    const schedule = await this.schedule(tenantId);
    const earliest = new Date(Date.now() + (schedule?.minNoticeHours ?? 0) * 3600 * 1000);
    const profs = await this.dayFromTrinks(tenantId, client, extId, civil.date, true);
    const day = unionSlots(civil.date, profs, able, earliest);
    const slot = day.slots.find((s) => s.time === time);
    if (!slot) {
      const later = await this.fetchDays(tenantId, service, addDaysToDateStr(civil.date, 1), { maxDays: 5 }).catch(() => [] as TrinksDay[]);
      const wanted = timeToMinutes(time);
      const sameDay = day.slots
        .map((s) => ({ date: civil.date, time: s.time, dist: Math.abs(timeToMinutes(s.time) - wanted) }))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 3)
        .sort((a, b) => a.time.localeCompare(b.time))
        .map(({ date, time: t }) => ({ date, time: t }));
      const alt = [...sameDay, ...later.flatMap((d) => d.slots.map((s) => ({ date: d.date, time: s.time })))].slice(0, 3);
      throw new AgendaConflictError('Esse horário não está mais livre na Trinks', alt);
    }
    const order = (catalog?.professionals ?? []).map((p) => p.id);
    const id = pickTrinksProfessional(slot.professionalIds, slot.freeCount, order);
    const nome = catalog?.professionals.find((p) => p.id === id)?.nome ?? profs.find((p) => p.id === id)?.nome ?? '';
    return { id, nome };
  }

  // ───────── Cliente ─────────

  private async findClientId(client: TrinksClient, phone: string): Promise<number | null> {
    const target = splitBrazilPhone(phone);
    if (!target) return null;
    const found = await client.searchClientsByPhone(target.numero.slice(-8));
    return found.find((c) => c.telefones.some((t) => samePhone(t, target)))?.id ?? null;
  }

  private async findOrCreateClient(client: TrinksClient, lead: Lead, name: string): Promise<number> {
    const target = splitBrazilPhone(lead.phone);
    if (!target) throw new TrinksApiError(400, `Telefone da cliente inválido para a Trinks (${lead.phone})`);
    const previous = await this.apptRepo.findOne({ where: { leadId: lead.id, externalProvider: 'trinks' }, order: { createdAt: 'DESC' } });
    if (previous?.externalClientId) return Number(previous.externalClientId);
    const existing = await this.findClientId(client, lead.phone);
    if (existing) return existing;
    const clean = (name ?? '').replace(/\s+/g, ' ').trim();
    const nome = clean.length >= 3 && !/^\d+$/.test(clean) ? clean : `Cliente WhatsApp ${target.ddd} ${target.numero}`;
    return client.createClient({ nome: nome.slice(0, 300), ddd: target.ddd, numero: target.numero });
  }

  private async lastInboundText(leadId: string): Promise<string | null> {
    try {
      const rows = await this.dataSource.query(
        `SELECT m.content FROM messages m JOIN conversations c ON c.id = m.conversation_id
          WHERE c.lead_id = $1 AND m.direction = 'inbound' AND m.content IS NOT NULL
          ORDER BY m.created_at DESC LIMIT 1`,
        [leadId],
      );
      const t = String(rows?.[0]?.content ?? '').replace(/\s+/g, ' ').trim();
      return t || null;
    } catch {
      return null;
    }
  }

  // ───────── Lembrete ─────────

  private async stillActive(appt: Appointment): Promise<boolean> {
    if (!appt.tenantId || !appt.externalId) return true;
    const { client, integration } = await this.integration.clientFor(appt.tenantId);
    const remote = await client.getAppointment(appt.externalId).catch((err) => {
      if (err instanceof TrinksApiError && err.status === 404) return null;
      throw err;
    });
    if (!remote || !TRINKS_ACTIVE_STATUS.includes(remote.status?.id ?? -1)) {
      await this.apptRepo.update({ id: appt.id }, { status: 'cancelado' });
      this.logger.log(`[TRINKS] Lembrete não enviado: agendamento ${appt.externalId} não está ativo na Trinks`);
      return false;
    }
    const start = fromTrinksLocal(remote.dataHoraInicio);
    if (start.getTime() !== appt.startDateTime.getTime()) {
      // Remarcado direto na Trinks: atualiza a cópia e o lembrete vai no horário novo.
      await this.syncMirror(appt, remote, integration.catalog);
      this.logger.log(`[TRINKS] Lembrete adiado: agendamento ${appt.externalId} mudou de horário na Trinks`);
      return false;
    }
    return true;
  }
}

