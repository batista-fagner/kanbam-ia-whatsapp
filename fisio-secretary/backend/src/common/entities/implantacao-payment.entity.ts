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

  @Column({ type: 'varchar', nullable: true })
  email: string | null;

  @Column({ type: 'varchar', default: 'pending' })
  status: ImplantacaoStatus;

  // Valor cobrado, congelado no momento da cobrança. Sem isso a receita de implantação só
  // existia num billing_event solto (tenant_id null), impossível de atribuir ao cliente.
  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true })
  amount: string | null;

  // Preenchido quando dá pra ligar a implantação a um tenant (por telefone/e-mail). Fica null
  // enquanto a conta não existe — a implantação é paga ANTES do cadastro do cliente.
  @Column({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
