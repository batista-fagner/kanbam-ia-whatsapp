import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Unique } from 'typeorm';

// Relatório diário gerado às 18h (group-monitor-report.service.ts) por grupo "Projeto
// <cliente>". rawJson guarda a resposta estruturada completa da IA — mantém o dado pronto
// pra virar PDF no futuro sem reprocessar nada (summary em texto puro + campos estruturados,
// nunca HTML acoplado à UI).
@Entity('group_daily_reports')
@Unique(['tenantId', 'reportDate'])
export class GroupDailyReport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'group_jid', type: 'varchar' })
  groupJid: string;

  @Column({ name: 'report_date', type: 'date' })
  reportDate: string; // YYYY-MM-DD (fuso America/Sao_Paulo)

  @Column({ name: 'message_count', type: 'integer', default: 0 })
  messageCount: number;

  @Column({ type: 'text' })
  summary: string;

  @Column({ type: 'varchar' })
  sentiment: 'positivo' | 'neutro' | 'risco';

  // Ex: ["prazo de entrega", "como funciona o financeiro"] — usado pra agregar padrões
  // entre clientes e apontar onde falta melhorar onboarding/documentação/prompt.
  @Column({ name: 'doubt_categories', type: 'jsonb', default: () => `'[]'::jsonb` })
  doubtCategories: string[];

  @Column({ name: 'opportunity_signal', type: 'boolean', default: false })
  opportunitySignal: boolean;

  @Column({ name: 'opportunity_note', type: 'text', nullable: true })
  opportunityNote: string | null;

  // true quando a equipe falou algo no grupo no dia e o cliente não respondeu depois
  // disso até o fechamento do relatório (18h) — sinal de possível churn silencioso,
  // calculado por horário (não pela IA) em group-monitor-report.service.ts.
  @Column({ name: 'awaiting_client_response', type: 'boolean', default: false })
  awaitingClientResponse: boolean;

  // Resposta bruta da IA (JSON completo) — preparo pra PDF futuro sem reprocessar.
  @Column({ name: 'raw_json', type: 'jsonb', nullable: true })
  rawJson: Record<string, any> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
