import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

// Bloqueio pontual da agenda (folga, feriado, horário fechado) — some do preview de
// horários livres e da checagem da IA enquanto o intervalo durar.
@Entity('schedule_blocks')
export class ScheduleBlock {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'start_date_time', type: 'timestamp' })
  startDateTime: Date;

  @Column({ name: 'end_date_time', type: 'timestamp' })
  endDateTime: Date;

  @Column({ type: 'varchar', nullable: true })
  reason: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
