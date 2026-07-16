import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

// Tabela de linha única (id fixo) — configuração global do checkout público,
// editável pelo admin em vez de hardcoded no código/frontend.
@Entity('checkout_settings')
export class CheckoutSettings {
  @PrimaryColumn({ type: 'int', default: 1 })
  id: number;

  @Column({ name: 'pix_enabled', type: 'boolean', default: true })
  pixEnabled: boolean;

  @Column({ name: 'card_enabled', type: 'boolean', default: false })
  cardEnabled: boolean;

  @Column({ name: 'implantacao_enabled', type: 'boolean', default: true })
  implantacaoEnabled: boolean;

  @Column({ name: 'plano_enabled', type: 'boolean', default: true })
  planoEnabled: boolean;

  @Column({ name: 'implantacao_price', type: 'numeric', precision: 10, scale: 2, default: 400 })
  implantacaoPrice: string;

  @Column({ name: 'plano_price', type: 'numeric', precision: 10, scale: 2, default: 390 })
  planoPrice: string;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
