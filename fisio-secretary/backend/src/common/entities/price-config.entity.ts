import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

// Config de preço ESTRUTURADA (não texto de prompt) usada pelo motor de cálculo
// determinístico em código — existe pra tenants com venda por gramatura, onde a
// IA erra a própria conta (~20% medido no S&A em 2026-08-26, ex: 389,90×1,5
// virou 583,35 em vez de 584,85). A IA continua identificando produto/gramas/
// forma de pagamento (isso ela faz bem); quem soma e multiplica é o código.
//
// Opt-in por tenant: só entra em uso se isActive=true e products não vazio —
// tenant sem linha aqui segue exatamente como hoje (preço calculado pela IA
// via texto do módulo). Ver PriceCalcService.
@Entity('price_configs')
@Index('UQ_price_configs_tenant', ['tenantId'], { unique: true })
export class PriceConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'is_active', type: 'boolean', default: false })
  isActive: boolean;

  // Lista de produtos: [{ key, label, price100g }]. `key` é o identificador
  // ESTÁVEL que a IA usa no JSON (mesmo padrão de matching exato do
  // mediaName) — nunca muda mesmo que o `label` seja editado.
  @Column({ name: 'products', type: 'jsonb', default: () => "'[]'" })
  products: { key: string; label: string; price100g: number }[];

  // Regras de acréscimo/desconto — todas em R$ por 100g, exceto tela (R$/grama).
  // null = essa forma de cobrança não existe pra esse tenant (motor não oferece).
  @Column({ name: 'tela_per_gram', type: 'numeric', precision: 10, scale: 2, nullable: true })
  telaPerGram: number | null;

  @Column({ name: 'cartao_surcharge_per_100g', type: 'numeric', precision: 10, scale: 2, nullable: true })
  cartaoSurchargePer100g: number | null;

  @Column({ name: 'especie_discount_per_100g', type: 'numeric', precision: 10, scale: 2, nullable: true })
  especieDiscountPer100g: number | null;

  // Venda em múltiplos de `gramStep`, gramatura mínima `minGram`.
  @Column({ name: 'min_gram', type: 'int', default: 50 })
  minGram: number;

  @Column({ name: 'gram_step', type: 'int', default: 50 })
  gramStep: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
