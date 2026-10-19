import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';
import { Lead } from './lead.entity';

export type AppointmentService = 'mega_hair' | 'manutencao' | (string & {});
export type AppointmentStatus = 'agendado' | 'confirmado' | 'realizado' | 'cancelado' | 'nao_compareceu';

@Entity('appointments')
export class Appointment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Tenant (multi-cliente): FK lógica → whatsapp_config.id. Nullable na Fase 1.
  @Column({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId: string | null;

  @Column({ name: 'lead_id', nullable: true, type: 'uuid' })
  leadId: string | null;

  @ManyToOne(() => Lead, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'lead_id' })
  lead: Lead | null;

  @Column({ name: 'client_name', type: 'varchar' })
  clientName: string;

  @Column({ name: 'client_phone', type: 'varchar', nullable: true })
  clientPhone: string | null;

  @Column({ type: 'varchar', default: 'mega_hair' })
  service: AppointmentService;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  value: number | null;

  @Column({ type: 'varchar', default: 'agendado' })
  status: AppointmentStatus;

  @Column({ name: 'start_date_time', type: 'timestamp' })
  startDateTime: Date;

  // Null nos agendamentos antigos e em tenants sem agenda configurada — o término,
  // nesse caso, é calculado como startDateTime + slotMinutes (ver ScheduleService).
  @Column({ name: 'end_date_time', type: 'timestamp', nullable: true })
  endDateTime: Date | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  // Agenda com profissionais (tenant_schedules.mode='professionals'). Null nos agendamentos
  // antigos e nos tenants com agenda simples.
  @Column({ name: 'professional_id', type: 'uuid', nullable: true })
  professionalId: string | null;

  @Column({ name: 'service_id', type: 'uuid', nullable: true })
  serviceId: string | null;

  // 'ia' = marcado pela IA no WhatsApp; 'manual' = marcado pela recepção na tela.
  @Column({ type: 'varchar', nullable: true })
  source: 'ia' | 'manual' | null;

  @Column({ name: 'reminder_sent_at', type: 'timestamp', nullable: true })
  reminderSentAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
