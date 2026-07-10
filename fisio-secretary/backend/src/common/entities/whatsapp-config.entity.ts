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

  // Lembrete de agendamento: enviado ~24h antes. Ex: { enabled, message }
  @Column({ name: 'appointment_reminder', type: 'jsonb', nullable: true })
  appointmentReminder: { enabled: boolean; message: string } | null;

  // Limite de vídeos enviados pela IA por dia (contagem BRT). Padrão: 41.
  @Column({ name: 'media_limit_per_day', type: 'integer', default: 41 })
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

  // --- Pagamento Stripe (D2) ---
  @Column({ name: 'stripe_customer_id', type: 'varchar', nullable: true })
  stripeCustomerId: string | null;

  @Column({ name: 'stripe_subscription_id', type: 'varchar', nullable: true })
  stripeSubscriptionId: string | null;

  // 'manual' (legado/sem Stripe) | 'card' (subscription) | 'pix' (Stripe PIX mensal)
  @Column({ name: 'payment_method', type: 'varchar', default: 'manual' })
  paymentMethod: string;

  // 'active' | 'past_due' | 'pending' | 'canceled'
  @Column({ name: 'plan_status', type: 'varchar', default: 'active' })
  planStatus: string;

  // Data do último PIX enviado — evita reenvio no mesmo dia
  @Column({ name: 'last_pix_sent_at', type: 'date', nullable: true })
  lastPixSentAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
