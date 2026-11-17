import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

// Cliente de tráfego pago que recebe relatório semanal no grupo de WhatsApp.
// NÃO é tenant do CRM (não tem whatsapp_config): cliente de tráfego pode nem usar a IA.
@Entity('traffic_report_clients')
export class TrafficReportClient {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Nome que aparece no título do relatório.
  @Column({ type: 'varchar' })
  name: string;

  // Conta de anúncio na Meta, só os números (sem "act_").
  @Column({ name: 'ad_account_id', type: 'varchar' })
  adAccountId: string;

  // Grupo que recebe o relatório aprovado (o número da empresa precisa estar no grupo).
  @Column({ name: 'group_jid', type: 'varchar' })
  groupJid: string;

  // Quem aprova antes do envio.
  @Column({ name: 'approver_phone', type: 'varchar' })
  approverPhone: string;

  // true = manda o rascunho para o aprovador e só envia ao grupo depois do "Aprovar".
  // false = envia direto ao grupo (para quando o formato estiver validado).
  @Column({ name: 'require_approval', type: 'boolean', default: true })
  requireApproval: boolean;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  // Dia (YYYY-MM-DD, horário de Brasília) do próximo relatório. Avança de 7 em 7.
  @Column({ name: 'next_report_date', type: 'date' })
  nextReportDate: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
