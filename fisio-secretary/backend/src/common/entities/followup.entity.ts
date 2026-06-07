import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, Index,
} from 'typeorm';

export type FollowupStatus = 'pending' | 'sent' | 'canceled' | 'failed';

// Follow-up agendado por lead: o operador escreve (ou a IA gera) uma mensagem
// e define quando enviar (1h / 4h / 24h). Um cron envia quando chega a hora.
@Entity('followups')
@Index('IDX_followups_due', ['status', 'scheduledAt'])
export class Followup {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'lead_id', type: 'uuid' })
  leadId: string;

  // Telefone desnormalizado p/ o cron enviar sem recarregar o lead.
  @Column()
  phone: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ name: 'scheduled_at', type: 'timestamp' })
  scheduledAt: Date;

  @Column({ default: 'pending' })
  status: FollowupStatus;

  // 'manual' (operador digitou) | 'ai' (sugerido pela IA e aprovado)
  @Column({ default: 'manual' })
  source: string;

  @Column({ name: 'sent_at', type: 'timestamp', nullable: true })
  sentAt: Date | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
