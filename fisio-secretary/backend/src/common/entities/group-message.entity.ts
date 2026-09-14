import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

// Mensagens dos grupos "Projeto <cliente>" (criados por OnboardingService.createProjectGroup)
// capturadas pelo webhook dedicado da instância sender (BILLING_SENDER_TOKEN) — ver
// group-monitor.controller.ts / GroupMonitorService.ingestMessage. Só existe a partir da
// data em que essa instância foi conectada — não tem histórico anterior. Alimenta o
// relatório diário (group-monitor-report.service.ts) e a classificação de risco em tempo real.
@Entity('group_messages')
@Index(['tenantId', 'createdAt'])
@Index(['groupJid', 'createdAt'])
export class GroupMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Resolvido via whatsapp_config.onboarding_group_jid = groupJid — não é FK, é snapshot
  // (mesmo padrão de FinanceiroWhatsappMessage.tenantId).
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'group_jid', type: 'varchar' })
  groupJid: string;

  @Column({ name: 'sender_phone', type: 'varchar', nullable: true })
  senderPhone: string | null;

  // Snapshot do nome de quem enviou (só pra exibir no transcript do relatório).
  @Column({ name: 'sender_name', type: 'varchar', nullable: true })
  senderName: string | null;

  // Calculado comparando senderPhone contra whatsapp_config.billingPhone (client) e
  // onboarding_settings.teamPhones (team). 'unknown' quando não bate com nenhum dos dois.
  @Column({ name: 'sender_role', type: 'varchar', default: 'unknown' })
  senderRole: 'client' | 'team' | 'unknown';

  @Column({ name: 'message_type', type: 'varchar', default: 'text' })
  messageType: 'text' | 'audio' | 'image' | 'other';

  // Texto puro, ou transcrição (áudio), ou um placeholder tipo '[imagem]' (sem OCR nesta fase).
  @Column({ type: 'text' })
  content: string;

  @Column({ name: 'external_message_id', type: 'varchar', nullable: true })
  externalMessageId: string | null;

  // Preenchidos pela classificação de risco em tempo real (fire-and-forget, não bloqueia o webhook).
  @Column({ name: 'risk_flagged', type: 'boolean', default: false })
  riskFlagged: boolean;

  @Column({ name: 'risk_reason', type: 'text', nullable: true })
  riskReason: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
