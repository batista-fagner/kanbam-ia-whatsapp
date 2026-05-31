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
}
