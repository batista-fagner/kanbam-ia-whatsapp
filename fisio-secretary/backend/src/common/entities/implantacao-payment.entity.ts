import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export type ImplantacaoStatus = 'pending' | 'paid' | 'expired';

@Entity('implantacao_payments')
export class ImplantacaoPayment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column()
  phone: string;

  @Column({ type: 'varchar', default: 'pending' })
  status: ImplantacaoStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
