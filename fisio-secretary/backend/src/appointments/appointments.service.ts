import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Appointment, AppointmentService as ServiceType, AppointmentStatus } from '../common/entities/appointment.entity';

export interface CreateAppointmentDto {
  tenantId?: string | null;
  leadId?: string | null;
  clientName: string;
  clientPhone?: string | null;
  service: ServiceType;
  value?: number | null;
  status?: AppointmentStatus;
  startDateTime: Date | string;
  notes?: string | null;
}

export type UpdateAppointmentDto = Partial<CreateAppointmentDto>;

@Injectable()
export class AppointmentsService {
  constructor(
    @InjectRepository(Appointment)
    private readonly repo: Repository<Appointment>,
  ) {}

  async findByMonth(year: number, month: number, tenantId?: string): Promise<Appointment[]> {
    const start = new Date(year, month - 1, 1, 0, 0, 0);
    const end = new Date(year, month, 0, 23, 59, 59);
    return this.repo.find({
      where: { startDateTime: Between(start, end), ...(tenantId ? { tenantId } : {}) },
      order: { startDateTime: 'ASC' },
      relations: ['lead'],
    });
  }

  async findOne(id: string, tenantId?: string): Promise<Appointment> {
    const where: any = { id };
    if (tenantId) where.tenantId = tenantId;
    const appt = await this.repo.findOne({ where, relations: ['lead'] });
    if (!appt) throw new NotFoundException('Agendamento não encontrado');
    return appt;
  }

  async create(dto: CreateAppointmentDto): Promise<Appointment> {
    const appt = this.repo.create({
      tenantId: dto.tenantId ?? null,
      leadId: dto.leadId ?? null,
      clientName: dto.clientName,
      clientPhone: dto.clientPhone ?? null,
      service: dto.service,
      value: dto.value ?? null,
      status: dto.status ?? 'agendado',
      startDateTime: typeof dto.startDateTime === 'string' ? new Date(dto.startDateTime) : dto.startDateTime,
      notes: dto.notes ?? null,
    });
    return this.repo.save(appt);
  }

  async update(id: string, dto: UpdateAppointmentDto, tenantId?: string): Promise<Appointment> {
    const appt = await this.findOne(id, tenantId);
    if (dto.clientName !== undefined) appt.clientName = dto.clientName;
    if (dto.clientPhone !== undefined) appt.clientPhone = dto.clientPhone;
    if (dto.service !== undefined) appt.service = dto.service;
    if (dto.value !== undefined) appt.value = dto.value;
    if (dto.status !== undefined) appt.status = dto.status;
    if (dto.startDateTime !== undefined) {
      appt.startDateTime = typeof dto.startDateTime === 'string' ? new Date(dto.startDateTime) : dto.startDateTime;
    }
    if (dto.notes !== undefined) appt.notes = dto.notes;
    if (dto.leadId !== undefined) appt.leadId = dto.leadId;
    return this.repo.save(appt);
  }

  async delete(id: string, tenantId?: string): Promise<void> {
    const criteria: any = tenantId ? { id, tenantId } : { id };
    const result = await this.repo.delete(criteria);
    if (result.affected === 0) throw new NotFoundException('Agendamento não encontrado');
  }

  async cancelActiveByLeadId(leadId: string): Promise<number> {
    const result = await this.repo.update({ leadId, status: 'agendado' }, { status: 'cancelado' });
    return result.affected ?? 0;
  }

  // Busca agendamentos que devem receber lembrete ~24h antes.
  // Janela de [now+22h, now+26h] garante tolerância para variação do cron horário.
  // Agendamentos que já cruzaram o limiar de antecedência configurado pelo tenant
  // (`hoursBefore`) e ainda não receberam lembrete.
  //
  // A janela é aberta pra trás (tudo que falta <= hoursBefore) em vez de uma faixa
  // fixa em torno do alvo: com antecedência configurável (1h, 12h, 24h...) uma faixa
  // estreita perderia o agendamento se o cron atrasasse um ciclo, e uma faixa larga
  // mandaria o lembrete de 1h com 3h de antecedência. Como o cron roda a cada 5min e
  // reminder_sent_at trava o reenvio, disparar no primeiro tick após o limiar dá o
  // envio mais próximo possível do alvo, sem risco de perder o agendamento.
  //
  // MIN_LEAD_MINUTES evita o caso do agendamento criado já dentro da janela (ex.:
  // marcou pra daqui 20min com lembrete de 24h): lembrete em cima da hora — ou depois
  // do horário — não reduz no-show, só incomoda.
  private static readonly MIN_LEAD_MINUTES = 10;

  async findDueReminders(tenantId: string, hoursBefore = 24): Promise<Appointment[]> {
    const now = Date.now();
    const windowStart = new Date(now + AppointmentsService.MIN_LEAD_MINUTES * 60 * 1000);
    const windowEnd = new Date(now + hoursBefore * 60 * 60 * 1000);
    if (windowEnd <= windowStart) return [];
    return this.repo
      .createQueryBuilder('a')
      .where('a.tenant_id = :tenantId', { tenantId })
      .andWhere('a.status IN (:...statuses)', { statuses: ['agendado', 'confirmado'] })
      .andWhere('a.start_date_time >= :windowStart', { windowStart })
      .andWhere('a.start_date_time <= :windowEnd', { windowEnd })
      .andWhere('a.reminder_sent_at IS NULL')
      .andWhere('a.client_phone IS NOT NULL')
      .getMany();
  }

  async markReminderSent(id: string): Promise<void> {
    await this.repo.update({ id }, { reminderSentAt: new Date() });
  }
}
