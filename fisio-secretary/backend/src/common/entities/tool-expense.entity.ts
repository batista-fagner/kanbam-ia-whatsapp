import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

// Ferramentas/serviços que a empresa paga pra operar (Supabase, uazapi, etc.). Usado na
// aba Financeiro pra descontar o custo fixo mensal da margem — não é por cliente, é custo
// da operação como um todo. billingDay é só o dia do mês (sem data completa) porque a
// maioria é assinatura recorrente sem uma "data de vencimento" única a rastrear.
@Entity('tool_expenses')
export class ToolExpense {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ name: 'monthly_cost', type: 'numeric', precision: 10, scale: 2 })
  monthlyCost: string;

  @Column({ name: 'billing_day', type: 'int', nullable: true })
  billingDay: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
