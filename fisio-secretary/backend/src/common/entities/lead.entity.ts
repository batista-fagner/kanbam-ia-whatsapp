import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, OneToMany, OneToOne,
  BeforeInsert, BeforeUpdate, Index,
} from 'typeorm';
import { Conversation } from './conversation.entity';
import { LeadStageHistory } from './lead-stage-history.entity';

export type LeadStage =
  | 'novo_lead' | 'lead_frio' | 'lead_quente'
  | 'agendado' | 'vendas' | 'desliza_hair' | 'perdido';

export type LeadTemperature = 'quente' | 'morno' | 'frio';

@Entity('leads')
// Unique por tenant: o mesmo número pode existir em clientes diferentes.
@Index('UQ_leads_tenant_phone', ['tenantId', 'phone'], { unique: true })
export class Lead {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Tenant (multi-cliente): FK lógica para whatsapp_config.id.
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column()
  phone: string;

  @Column({ type: 'varchar', nullable: true })
  name: string | null;

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

  @Column({ nullable: true, type: 'text' })
  observations: string | null;

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

  @Column({ name: 'calendar_event_link', nullable: true, type: 'text' })
  calendarEventLink: string | null;

  @Column({ name: 'last_message_at', nullable: true, type: 'timestamp' })
  lastMessageAt: Date;

  @Column({ name: 'last_message_direction', nullable: true, type: 'varchar' })
  lastMessageDirection: 'inbound' | 'outbound' | null;

  @Column({ type: 'jsonb', default: [] })
  labels: string[];

  // Raias para as quais este lead já recebeu follow-up automático (1x por raia, para sempre).
  @Column({ name: 'auto_followup_sent_stages', type: 'jsonb', default: [] })
  autoFollowupSentStages: string[];

  // Agente atual no sistema multi-agente. Null = supervisor decide na próxima mensagem.
  @Column({ name: 'current_agent_id', type: 'uuid', nullable: true })
  currentAgentId: string | null;

  // Nomes dos módulos carregados no turno anterior (protótipo "agente único +
  // módulos dinâmicos" — só usado quando prompt_engine='dynamic_modules'). Serve
  // pra continuidade: resposta curta sem palavra-chave ("100", "sim") mantém os
  // módulos do turno anterior em vez de perder o contexto.
  @Column({ name: 'active_modules', type: 'jsonb', default: [] })
  activeModules: string[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @BeforeInsert()
  @BeforeUpdate()
  normalizePhone() {
    if (this.phone) {
      this.phone = this.phone.replace(/\D/g, '');
    }
  }

  @OneToOne(() => Conversation, (c) => c.lead)
  conversation: Conversation;

  @OneToMany(() => LeadStageHistory, (h) => h.lead)
  stageHistory: LeadStageHistory[];
}
