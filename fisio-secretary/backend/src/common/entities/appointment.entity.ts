import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';
import { Lead } from './lead.entity';

@Entity('appointments')
export class Appointment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'lead_id' })
  leadId: string;

  @Column({ name: 'scheduled_at', type: 'timestamp' })
  scheduledAt: Date;

  @Column({ name: 'duration_min', default: 60 })
  durationMin: number;

  @Column({ name: 'service_type', nullable: true })
  serviceType: string;

  @Column({ default: 'scheduled' })
  status: string;

  @Column({ nullable: true, type: 'text' })
  notes: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => Lead, (l) => l.appointments)
  @JoinColumn({ name: 'lead_id' })
  lead: Lead;
}
