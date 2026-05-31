import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('media_files')
// Unique por tenant: cada cliente tem seu próprio catálogo.
@Index('UQ_media_files_tenant_name', ['tenantId', 'name'], { unique: true })
export class MediaFile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Tenant (multi-cliente): catálogo de mídia é por cliente.
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column()
  name: string;

  @Column({ type: 'text' })
  url: string;

  @Column({ name: 'storage_path', type: 'text' })
  storagePath: string;

  @Column({ name: 'mime_type', nullable: true })
  mimeType: string;

  @Column({ nullable: true })
  size: number;

  @Column({ name: 'reel_codes', type: 'text', array: true, nullable: true, default: () => "'{}'" })
  reelCodes: string[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
