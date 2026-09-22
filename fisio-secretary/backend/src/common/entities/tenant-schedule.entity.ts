import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export interface WeeklyHoursInterval {
  start: string; // "HH:MM"
  end: string; // "HH:MM"
}

// weekly_hours: chave "0" (domingo) a "6" (sábado) → lista de intervalos abertos naquele
// dia. Dia ausente do objeto = fechado. Ex: {"1":[{"start":"09:00","end":"12:00"},{"start":"13:00","end":"18:00"}]}
export type WeeklyHours = Record<string, WeeklyHoursInterval[]>;

// Agenda de funcionamento por tenant, usada pela IA (Lindona/megahair) pra oferecer só
// horários realmente livres em vez do 09:00 fixo (ver AGENDAMENTO em ai.service.ts).
// 1 linha por tenant — não é singleton como OnboardingSettings/GroupMonitorSettings.
@Entity('tenant_schedules')
export class TenantSchedule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid', unique: true })
  tenantId: string;

  // Se false, a IA volta ao comportamento padrão (09:00 fixo, sem checar agenda).
  @Column({ type: 'boolean', default: false })
  enabled: boolean;

  @Column({ name: 'slot_minutes', type: 'integer', default: 60 })
  slotMinutes: number;

  // Quantos agendamentos cabem no mesmo horário (ex: mais de uma profissional atendendo).
  @Column({ type: 'integer', default: 1 })
  capacity: number;

  @Column({ name: 'booking_window_days', type: 'integer', default: 14 })
  bookingWindowDays: number;

  @Column({ name: 'min_notice_hours', type: 'integer', default: 2 })
  minNoticeHours: number;

  @Column({ name: 'weekly_hours', type: 'jsonb', default: () => `'{}'::jsonb` })
  weeklyHours: WeeklyHours;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
