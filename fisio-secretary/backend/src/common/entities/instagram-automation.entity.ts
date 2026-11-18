import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

// Automação de comentário de um post: quem comentar (qualquer coisa ou palavra-chave) recebe
// um Direct com botão para o WhatsApp e, se configurado, uma resposta pública no comentário.
@Entity('instagram_automations')
export class InstagramAutomation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'post_id', type: 'varchar' })
  postId: string;

  // Foto do post no momento do cadastro (o post pode ser apagado depois).
  @Column({ name: 'post_caption', type: 'text', nullable: true })
  postCaption: string | null;

  @Column({ name: 'post_thumbnail', type: 'text', nullable: true })
  postThumbnail: string | null;

  @Column({ name: 'post_permalink', type: 'varchar', nullable: true })
  postPermalink: string | null;

  // 'any' = qualquer comentário; 'keyword' = só quem escrever uma das palavras.
  @Column({ name: 'trigger_mode', type: 'varchar', default: 'keyword' })
  triggerMode: 'any' | 'keyword';

  // Separadas por vírgula ou quebra de linha.
  @Column({ type: 'text', default: '' })
  keywords: string;

  @Column({ name: 'comment_reply', type: 'text', nullable: true })
  commentReply: string | null;

  @Column({ name: 'dm_text', type: 'text' })
  dmText: string;

  @Column({ name: 'button_label', type: 'varchar', default: 'Falar no WhatsApp' })
  buttonLabel: string;

  // Vazio = usa o número padrão da conta.
  @Column({ name: 'whatsapp_phone', type: 'varchar', nullable: true })
  whatsappPhone: string | null;

  @Column({ name: 'whatsapp_text', type: 'varchar', default: 'Oi! Vim pelo Instagram 😊' })
  whatsappText: string;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ name: 'triggered_count', type: 'int', default: 0 })
  triggeredCount: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
