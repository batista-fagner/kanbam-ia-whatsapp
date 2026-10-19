import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import type { WeeklyHours } from './tenant-schedule.entity';

// Profissional da agenda com profissionais (tenant_schedules.mode='professionals').
// Não tem login: recebe aviso no WhatsApp a cada agendamento/remarcação/cancelamento.
@Entity('agenda_professionals')
export class AgendaProfessional {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'varchar', default: '#0d9488' })
  color: string;

  @Column({ type: 'varchar', nullable: true })
  whatsapp: string | null;

  @Column({ type: 'boolean', default: true })
  notify: boolean;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder: number;

  // Vazio ({}) = usa o horário do salão (tenant_schedules.weekly_hours).
  @Column({ name: 'weekly_hours', type: 'jsonb', default: () => `'{}'::jsonb` })
  weeklyHours: WeeklyHours;

  // Ids de agenda_services que este profissional realiza (tabela agenda_professional_services).
  serviceIds?: string[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
