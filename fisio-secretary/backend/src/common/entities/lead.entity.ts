import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, OneToMany, OneToOne,
} from 'typeorm';
import { Conversation } from './conversation.entity';
import { LeadStageHistory } from './lead-stage-history.entity';
import { Appointment } from './appointment.entity';

export type LeadStage =
  | 'novo_lead' | 'qualificando' | 'lead_quente'
  | 'lead_frio' | 'agendado' | 'convertido' | 'perdido';

export type LeadTemperature = 'quente' | 'morno' | 'frio';

@Entity('leads')
export class Lead {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  phone: string;

  @Column({ nullable: true })
  name: string;

  @Column({ default: 'novo_lead' })
  stage: LeadStage;

  @Column({ nullable: true })
  temperature: LeadTemperature;

  @Column({ name: 'qualification_score', default: 0 })
  qualificationScore: number;

  @Column({ nullable: true, type: 'text' })
  symptoms: string;

  @Column({ nullable: true })
  urgency: string;

  @Column({ nullable: true })
  availability: string;

  @Column({ nullable: true })
  budget: string;

  @Column({ name: 'qualification_step', default: 0 })
  qualificationStep: number;

  @Column({ name: 'ai_context', type: 'jsonb', default: [] })
  aiContext: object[];

  @Column({ name: 'nurture_step', default: 0 })
  nurtureStep: number;

  @Column({ name: 'nurture_paused', default: false })
  nurturePaused: boolean;

  @Column({ name: 'next_nurture_at', nullable: true, type: 'timestamp' })
  nextNurtureAt: Date;

  @Column({ name: 'appointment_at', nullable: true, type: 'timestamp' })
  appointmentAt: Date | null;

  @Column({ name: 'calendar_event_id', nullable: true, type: 'text' })
  calendarEventId: string | null;

  @Column({ name: 'last_message_at', nullable: true, type: 'timestamp' })
  lastMessageAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToOne(() => Conversation, (c) => c.lead)
  conversation: Conversation;

  @OneToMany(() => LeadStageHistory, (h) => h.lead)
  stageHistory: LeadStageHistory[];

  @OneToMany(() => Appointment, (a) => a.lead)
  appointments: Appointment[];
}
