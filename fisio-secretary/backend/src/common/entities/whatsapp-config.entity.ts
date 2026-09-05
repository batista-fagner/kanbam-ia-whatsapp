import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('whatsapp_config')
export class WhatsappConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'instance_token', nullable: true })
  instanceToken: string;

  @Column({ name: 'profile_name', nullable: true })
  profileName: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ name: 'profile_pic_url', nullable: true, type: 'text' })
  profilePicUrl: string;

  @Column({ default: false })
  connected: boolean;

  @Column({ name: 'webhook_configured', default: false })
  webhookConfigured: boolean;

  @Column({ name: 'webhook_url', nullable: true, type: 'text' })
  webhookUrl: string;

  @Column({ name: 'agent_type', default: 'fisio' })
  agentType: string; // 'fisio' | 'megahair'

  @Column({ name: 'custom_prompt_sofia', nullable: true, type: 'text' })
  customPromptSofia: string | null;

  @Column({ name: 'custom_prompt_megahair', nullable: true, type: 'text' })
  customPromptMegaHair: string | null;

  // Follow-up automático por raia. Ex: { novo_lead: { enabled, idleMinutes, message }, ... }
  @Column({ name: 'auto_followup_config', type: 'jsonb', nullable: true })
  autoFollowupConfig: Record<string, { enabled: boolean; idleMinutes: number; message: string }> | null;

  // Chave-mestra: desliga o follow-up automático inteiro (todas as raias) sem apagar a config salva.
  // O cliente decide se quer o recurso ligado; default true para não quebrar quem já usa.
  @Column({ name: 'auto_followup_enabled', type: 'boolean', default: true })
  autoFollowupEnabled: boolean;

  // Lembrete de agendamento. `hoursBefore` = antecedência escolhida pelo cliente
  // (1..168h, default 24). Só dispara com enabled=true E message preenchida.
  @Column({ name: 'appointment_reminder', type: 'jsonb', nullable: true })
  appointmentReminder: { enabled: boolean; message: string; hoursBefore: number } | null;

  // Cadência de follow-up (múltiplos toques) por raia. Cada passo dispara depois de
  // `offsetMinutes` de silêncio contados a partir da última mensagem do lead — reinicia
  // toda vez que o lead responde. Ex: { lead_quente: [{ offsetMinutes: 5, angle: "..." }, ...] }
  @Column({ name: 'followup_cadence', type: 'jsonb', nullable: true })
  followupCadence: Record<string, { offsetMinutes: number; angle: string; fallbackMessage?: string }[]> | null;

  // Limite de vídeos enviados pela IA por dia (contagem BRT). Padrão: 100.
  @Column({ name: 'media_limit_per_day', type: 'integer', default: 100 })
  mediaLimitPerDay: number;

  // Limite de follow-ups automáticos enviados por dia (contagem BRT). Anti-bloqueio. Padrão: 40.
  @Column({ name: 'followup_limit_per_day', type: 'integer', default: 40 })
  followupLimitPerDay: number;

  // Quando true, usa o sistema multi-agente (Supervisor + sub-agentes) em vez do prompt único.
  @Column({ name: 'multi_agent_enabled', type: 'boolean', default: false })
  multiAgentEnabled: boolean;

  // 'legacy' = multi-agente com handoff (agents/AgentsService, padrão).
  // 'dynamic_modules' = protótipo agente único + módulos por palavra-chave
  // (PromptModule/DynamicPromptService) — em teste, só habilitado tenant a tenant.
  @Column({ name: 'prompt_engine', type: 'varchar', length: 30, default: 'legacy' })
  promptEngine: string;

  // Palavra que o operador digita no WhatsApp (fromMe) para desativar a IA daquele lead. Padrão: 'opa'.
  @Column({ name: 'deactivation_keyword', type: 'varchar', default: 'opa' })
  deactivationKeyword: string;

  // Palavra que o operador digita no WhatsApp (fromMe) para reativar a IA daquele lead. Padrão: 'volta'.
  @Column({ name: 'activation_keyword', type: 'varchar', default: 'volta' })
  activationKeyword: string;

  // --- Gestão do cliente (D1) ---
  // Nome do cliente/negócio para exibir no painel admin
  @Column({ name: 'display_name', type: 'varchar', nullable: true })
  displayName: string | null;

  // Suspensão: false bloqueia o login dos usuários deste tenant (controle manual / inadimplência)
  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  // Data do próximo vencimento — referência visual no painel admin
  @Column({ name: 'next_payment_date', type: 'date', nullable: true })
  nextPaymentDate: Date | null;

  // Dia fixo de vencimento mensal (1-31). Lembrete enviado 5 dias antes todo mês.
  @Column({ name: 'billing_day', type: 'integer', nullable: true })
  billingDay: number | null;

  // Telefone de contato pra cobrança (mensagem de vencimento)
  @Column({ name: 'billing_phone', type: 'varchar', nullable: true })
  billingPhone: string | null;

  // Telefone que recebe notificação automática sempre que um lead agenda (stage='agendado')
  @Column({ name: 'notification_phone', type: 'varchar', nullable: true })
  notificationPhone: string | null;

  // Quando true, a IA NUNCA agenda sozinha (MegaHair): ao detectar sinal de agendamento
  // (data/horário/visita), faz handoff pro humano (shouldIgnore=true) em vez de
  // action="schedule". Default false para não mudar quem já depende do agendamento
  // automático da IA. Ver JSON_FORMAT_MEGAHAIR_HANDOFF em ai.service.ts.
  @Column({ name: 'scheduling_handoff_enabled', type: 'boolean', default: false })
  schedulingHandoffEnabled: boolean;

  // --- Pagamento Stripe (D2) ---
  @Column({ name: 'stripe_customer_id', type: 'varchar', nullable: true })
  stripeCustomerId: string | null;

  @Column({ name: 'stripe_subscription_id', type: 'varchar', nullable: true })
  stripeSubscriptionId: string | null;

  // 'manual' (legado/sem Stripe) | 'card' (subscription) | 'pix' (Stripe PIX mensal)
  @Column({ name: 'payment_method', type: 'varchar', default: 'manual' })
  paymentMethod: string;

  // JID do grupo "Projeto <cliente>" criado automaticamente quando o pagamento é confirmado.
  // Serve de trava de idempotência (webhook duplicado do Stripe não cria grupo de novo) e é o
  // destino da 2ª mensagem de onboarding. Ver onboarding.service.ts.
  @Column({ name: 'onboarding_group_jid', type: 'varchar', nullable: true })
  onboardingGroupJid: string | null;

  // 'active' | 'past_due' | 'pending' | 'canceled'
  @Column({ name: 'plan_status', type: 'varchar', default: 'active' })
  planStatus: string;

  // Timestamp do último PIX enviado — evita reenvio no mesmo dia (billing-reminder) e é a base
  // pra expiração local de 6h (pollPendingPix, já que a Efí não expira status sozinha).
  @Column({ name: 'last_pix_sent_at', type: 'timestamp', nullable: true })
  lastPixSentAt: Date | null;

  // txid da cobrança PIX do ciclo de renovação atual. A Efí não permite reusar um txid já criado
  // (mesmo pago ou vencido) — cada ciclo de renovação precisa de um txid novo. Usado pelo polling
  // (pollPendingPix) e pelo webhook pra achar a cobrança certa. Nulo = ainda na 1ª cobrança (usa tenant.id).
  @Column({ name: 'last_pix_txid', type: 'varchar', nullable: true })
  lastPixTxid: string | null;

  // QR code (data:image/png;base64,...) e código copia-e-cola do PIX do ciclo atual (mesmo txid
  // acima). Persistidos pra alimentar a página pública /pix/:txid sem precisar reconsultar a Efí.
  @Column({ name: 'last_pix_qr_code', type: 'text', nullable: true })
  lastPixQrCode: string | null;

  @Column({ name: 'last_pix_code', type: 'text', nullable: true })
  lastPixCode: string | null;

  // Valor EXATO usado pra gerar o PIX acima (checkout usa checkoutSettings.planoPrice, renovação
  // usa tenant.planValue — fontes diferentes). A página /pix/:txid usa este campo, nunca recalcula
  // a partir de plan_value: esse pode mudar (ou estar nulo) entre a geração e a visualização.
  @Column({ name: 'last_pix_value', type: 'numeric', precision: 10, scale: 2, nullable: true })
  lastPixValue: string | null;

  // Valor mensal cobrado deste cliente (planos variados: 310, 490, ...). Sem valor cadastrado → fallback fixo no PaymentsService.
  @Column({ name: 'plan_value', type: 'numeric', precision: 10, scale: 2, nullable: true })
  planValue: string | null;

  // Quando o cliente enviou o Google Form de onboarding (agente de CS, Fase 1). Null = ainda não preencheu.
  @Column({ name: 'prompt_form_submitted_at', type: 'timestamp', nullable: true })
  promptFormSubmittedAt: Date | null;

  // --- Origem do cliente (tela Financeiro) ---
  // Duas fontes: UTM da URL do checkout (quando o link vem taggeado) ou sync por telefone
  // com o convertHairCRM, onde o lead original tem o UTM da campanha que trouxe a pessoa.
  @Column({ name: 'origin_source', type: 'varchar', nullable: true })
  originSource: string | null;

  @Column({ name: 'origin_medium', type: 'varchar', nullable: true })
  originMedium: string | null;

  @Column({ name: 'origin_campaign', type: 'varchar', nullable: true })
  originCampaign: string | null;

  // Última vez que o sync com o convertHairCRM preencheu esses campos (null = veio do checkout).
  @Column({ name: 'origin_synced_at', type: 'timestamp', nullable: true })
  originSyncedAt: Date | null;

  // Conta de teste do time ou lead que nunca chegou a pagar — some por completo da tela
  // Financeiro (MRR, receita, listas), diferente de churn (que fica visível como categoria).
  @Column({ name: 'is_test', type: 'boolean', default: false })
  isTest: boolean;

  // Churn manual (toggle no drawer do cliente) — tem prioridade sobre o status derivado de
  // plan_status/is_active na tela Financeiro. A receita histórica desse cliente continua
  // contando no acumulado; só sai do MRR/ativos.
  @Column({ name: 'churned_at', type: 'timestamp', nullable: true })
  churnedAt: Date | null;

  @Column({ name: 'churn_reason', type: 'varchar', nullable: true })
  churnReason: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
