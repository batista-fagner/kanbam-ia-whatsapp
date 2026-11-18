import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

// Conta de Instagram conectada de um cliente (1 por tenant). O token (IGAA…, 60 dias) fica
// criptografado com INTEGRATIONS_ENC_KEY e nunca volta para o front. As configurações de
// resposta ao Direct moram aqui também (1 conjunto por conta).
@Entity('instagram_accounts')
export class InstagramAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  // Id da conta profissional (o "entry.id" dos webhooks da Meta).
  @Index({ unique: true })
  @Column({ name: 'ig_user_id', type: 'varchar' })
  igUserId: string;

  @Column({ type: 'varchar', nullable: true })
  username: string | null;

  @Column({ name: 'token_enc', type: 'text' })
  tokenEnc: string;

  @Column({ name: 'token_refreshed_at', type: 'timestamp' })
  tokenRefreshedAt: Date;

  @Column({ name: 'token_expires_at', type: 'timestamp', nullable: true })
  tokenExpiresAt: Date | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  // Número padrão dos links de WhatsApp (só dígitos). Automação pode sobrescrever.
  @Column({ name: 'whatsapp_phone', type: 'varchar', nullable: true })
  whatsappPhone: string | null;

  // ── Resposta a quem manda Direct ──
  @Column({ name: 'dm_enabled', type: 'boolean', default: false })
  dmEnabled: boolean;

  @Column({ name: 'dm_text', type: 'text', default: '' })
  dmText: string;

  @Column({ name: 'dm_button_label', type: 'varchar', default: 'Falar no WhatsApp' })
  dmButtonLabel: string;

  @Column({ name: 'dm_whatsapp_text', type: 'varchar', default: 'Oi! Vim pelo Instagram 😊' })
  dmWhatsappText: string;

  // Quem já recebeu mensagem automática nesse intervalo não recebe outra (comentário ou Direct).
  @Column({ name: 'cooldown_hours', type: 'int', default: 24 })
  cooldownHours: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
