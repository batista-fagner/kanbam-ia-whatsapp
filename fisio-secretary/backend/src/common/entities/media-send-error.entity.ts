import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

// Registra toda falha no envio de mídia (vídeo/imagem) pro lead — tanto quando a
// uazapi rejeita o envio quanto quando a IA pede um nome de mídia que não existe
// no catálogo. Alimenta a tela de Monitoramento (aba Mídias), por tenant — antes
// disso essas falhas só apareciam no log do Railway, ninguém via (ver bug real do
// vídeo 4K da Telma, só descoberto porque a cliente reclamou).
@Entity('media_send_errors')
@Index(['tenantId', 'createdAt'])
export class MediaSendError {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'varchar', nullable: true })
  phone: string | null;

  @Column({ name: 'media_name', type: 'varchar', nullable: true })
  mediaName: string | null;

  // 'not_found' = a IA pediu um nome que não existe no catálogo do tenant.
  // 'send_failed' = o nome existe, mas a chamada à uazapi falhou (rede, arquivo
  // inválido, erro da API) — inclui o caso de vídeo grande demais.
  @Column({ type: 'varchar' })
  reason: 'not_found' | 'send_failed';

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
