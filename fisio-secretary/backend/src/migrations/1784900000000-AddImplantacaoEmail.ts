import { MigrationInterface, QueryRunner } from 'typeorm';

// Permite enviar a cobrança de implantação também por e-mail (via Resend), além do WhatsApp.
export class AddImplantacaoEmail1784900000000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE implantacao_payments ADD COLUMN IF NOT EXISTS email VARCHAR`);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE implantacao_payments DROP COLUMN IF EXISTS email`);
  }
}
