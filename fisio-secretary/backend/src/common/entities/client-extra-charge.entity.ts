import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn } from 'typeorm';

// Cobrança avulsa além da assinatura mensal — ex.: upgrade pra um plano de tráfego pago.
// Entra na receita do cliente na tela Financeiro (GET /admin/finance/overview), somada junto
// com billing_events. Lançado manualmente pelo admin no drawer do cliente.
@Entity('client_extra_charges')
@Index(['tenantId'])
export class ClientExtraCharge {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'varchar' })
  description: string;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  amount: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
