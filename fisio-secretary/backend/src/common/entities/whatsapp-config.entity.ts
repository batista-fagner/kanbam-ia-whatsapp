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

  // --- Gestão do cliente (D1) ---
  // Nome do cliente/negócio para exibir no painel admin
  @Column({ name: 'display_name', type: 'varchar', nullable: true })
  displayName: string | null;

  // Suspensão: false bloqueia o login dos usuários deste tenant (controle manual / inadimplência)
  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  // Data do próximo vencimento — usada pra alertar 5 dias antes (admin + cliente)
  @Column({ name: 'next_payment_date', type: 'date', nullable: true })
  nextPaymentDate: Date | null;

  // Telefone de contato pra cobrança (mensagem de vencimento)
  @Column({ name: 'billing_phone', type: 'varchar', nullable: true })
  billingPhone: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
