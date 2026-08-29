import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

// Mensagens trocadas pelo número da API Oficial (Meta) usado só pra cobrança/
// financeiro (+55 27 99668-0415) — separado do Kanban de leads porque esse
// número nunca conversa com lead, só com os próprios clientes do SaaS
// (billing_phone em whatsapp_config). Ver evolution.controller.ts:
// handleMetaWebhook() salva o inbound aqui em vez de cair no fluxo
// leadsService.findOrCreate()/IA.
@Entity('financeiro_whatsapp_messages')
export class FinanceiroWhatsappMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar' })
  phone: string;

  @Column({ type: 'varchar' })
  direction: 'inbound' | 'outbound';

  @Column({ type: 'text' })
  content: string;

  // Snapshot do nome do cliente no momento da mensagem (whatsapp_config.display_name
  // via billing_phone) — não é FK: o tenant pode ser excluído/renomeado depois e a
  // mensagem histórica continua legível.
  @Column({ name: 'client_name', type: 'varchar', nullable: true })
  clientName: string | null;

  @Column({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId: string | null;

  @Column({ name: 'external_message_id', type: 'varchar', nullable: true })
  externalMessageId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
