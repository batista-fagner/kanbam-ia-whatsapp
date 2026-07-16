import { MigrationInterface, QueryRunner } from 'typeorm';

// Permite o admin desligar o plano mensal e deixar só implantação no checkout
// (ex: fase de venda de implantação avulsa, sem assinatura ainda).
export class AddPlanoEnabled1784800000000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE checkout_settings ADD COLUMN IF NOT EXISTS plano_enabled BOOLEAN NOT NULL DEFAULT true`);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE checkout_settings DROP COLUMN IF EXISTS plano_enabled`);
  }
}
