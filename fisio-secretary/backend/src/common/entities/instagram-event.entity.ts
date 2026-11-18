import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

export type InstagramEventAction =
  | 'received'  // gravado, processamento em andamento
  | 'sent'      // Direct enviado
  | 'no_match'  // comentário sem automação/palavra-chave
  | 'cooldown'  // a pessoa já recebeu mensagem automática há pouco
  | 'disabled'  // Direct recebido com a resposta automática desligada
  | 'failed';   // a Meta recusou o envio

// Todo comentário/Direct recebido: serve de trava contra evento repetido (external_id único),
// de base para o intervalo entre mensagens por pessoa e para a tela "Atividade".
@Entity('instagram_events')
@Index(['tenantId', 'createdAt'])
@Index(['tenantId', 'senderIgId', 'createdAt'])
export class InstagramEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'varchar' })
  kind: 'comment' | 'dm';

  @Index({ unique: true })
  @Column({ name: 'external_id', type: 'varchar' })
  externalId: string;

  @Column({ name: 'sender_ig_id', type: 'varchar' })
  senderIgId: string;

  @Column({ name: 'sender_username', type: 'varchar', nullable: true })
  senderUsername: string | null;

  @Column({ name: 'post_id', type: 'varchar', nullable: true })
  postId: string | null;

  @Column({ type: 'text', default: '' })
  text: string;

  @Column({ name: 'automation_id', type: 'uuid', nullable: true })
  automationId: string | null;

  @Column({ type: 'varchar', default: 'received' })
  action: InstagramEventAction;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
