import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

// Serviço da agenda com profissionais. A duração define quanto tempo o horário fica ocupado.
@Entity('agenda_services')
export class AgendaServiceEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ name: 'duration_minutes', type: 'integer', default: 60 })
  durationMinutes: number;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  price: string | null;

  // Preço que não é fixo (ex.: "R$ 4 por grama") — mostrado no lugar/além do valor.
  @Column({ name: 'price_note', type: 'varchar', nullable: true })
  priceNote: string | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
