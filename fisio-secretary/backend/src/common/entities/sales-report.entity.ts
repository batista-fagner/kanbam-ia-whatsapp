import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

// Relatório de vendas gerado pela IA sob demanda da cliente (botão no CRM, limitado por
// semana — ver SALES_REPORT_RULES). Guarda o resultado (content), os números calculados
// pelo sistema (metrics) e o custo da geração, que aparece no Monitoramento.
@Entity('sales_reports')
@Index(['tenantId', 'createdAt'])
export class SalesReport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'period_start', type: 'timestamp' })
  periodStart: Date;

  @Column({ name: 'period_end', type: 'timestamp' })
  periodEnd: Date;

  // processing → done | failed. Só 'done' conta no limite semanal.
  @Column({ type: 'varchar', default: 'processing' })
  status: 'processing' | 'done' | 'failed';

  @Column({ type: 'jsonb', nullable: true })
  content: Record<string, any> | null;

  @Column({ type: 'jsonb', nullable: true })
  metrics: Record<string, any> | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ type: 'varchar', nullable: true })
  model: string | null;

  @Column({ name: 'input_tokens', type: 'int', default: 0 })
  inputTokens: number;

  @Column({ name: 'cached_tokens', type: 'int', default: 0 })
  cachedTokens: number;

  @Column({ name: 'output_tokens', type: 'int', default: 0 })
  outputTokens: number;

  @Column({ name: 'cost_usd', type: 'numeric', precision: 10, scale: 6, default: 0 })
  costUsd: number;

  // Envio do PDF para o WhatsApp de notificações da cliente.
  @Column({ name: 'pdf_sent_to', type: 'varchar', nullable: true })
  pdfSentTo: string | null;

  @Column({ name: 'pdf_error', type: 'text', nullable: true })
  pdfError: string | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
