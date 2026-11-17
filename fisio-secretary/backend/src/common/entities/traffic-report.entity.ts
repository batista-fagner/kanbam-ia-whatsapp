import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

export type TrafficReportStatus =
  | 'pending'    // rascunho enviado ao aprovador, aguardando
  | 'sending'    // aprovação recebida, envio ao grupo em andamento (trava contra clique duplo)
  | 'sent'       // enviado ao grupo
  | 'discarded'  // aprovador descartou
  | 'skipped'    // sem investimento no período — nada foi para o grupo
  | 'failed';    // não deu para gerar (ex: Meta fora do ar)

// Um relatório semanal gerado para um cliente de tráfego. Fica guardado mesmo depois de
// enviado: é o histórico do que foi dito ao cliente e com quais números.
@Entity('traffic_reports')
export class TrafficReport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'client_id', type: 'uuid' })
  clientId: string;

  @Column({ name: 'period_start', type: 'date' })
  periodStart: string;

  @Column({ name: 'period_end', type: 'date' })
  periodEnd: string;

  @Column({ type: 'varchar', default: 'pending' })
  status: TrafficReportStatus;

  // Texto que vai (ou foi) para o grupo. O aprovador pode editar antes de enviar.
  @Column({ type: 'text', default: '' })
  text: string;

  // Sinais técnicos mostrados só ao aprovador.
  @Column({ name: 'internal_note', type: 'text', default: '' })
  internalNote: string;

  @Column({ type: 'jsonb', nullable: true })
  metrics: Record<string, unknown> | null;

  // Segredo do link de aprovação (página pública, sem login).
  @Index({ unique: true })
  @Column({ name: 'approval_token', type: 'varchar' })
  approvalToken: string;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'sent_at', type: 'timestamp', nullable: true })
  sentAt: Date | null;
}
