import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

// Histórico de tentativas de cobrança PIX (renovação mensal) — auditoria e tela de monitoramento no Admin.
@Entity('billing_events')
@Index(['tenantId', 'createdAt'])
export class BillingEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Nulo pra implantação (taxa única paga ANTES de existir tenant) — usa "label" no lugar.
  @Column({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId: string | null;

  // Nome/e-mail do pagador quando não há tenant ainda (implantação).
  @Column({ type: 'varchar', nullable: true })
  label: string | null;

  // 'pix' = geração da cobrança na Efí. 'whatsapp' / 'email' = canais de entrega do PIX gerado.
  @Column({ type: 'varchar' })
  channel: 'pix' | 'whatsapp' | 'email';

  @Column({ type: 'varchar' })
  status: 'sent' | 'failed';

  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true })
  amount: string | null;

  @Column({ type: 'varchar', nullable: true })
  txid: string | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
