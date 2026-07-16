import { MigrationInterface, QueryRunner } from 'typeorm';

// Configuração global do checkout público (habilitar pix/cartão/implantação,
// valores), editável pelo admin — hoje era hardcoded no CheckoutPage/PaymentsService.
export class CreateCheckoutSettings1784700000000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE IF NOT EXISTS checkout_settings (
        id INT PRIMARY KEY DEFAULT 1,
        pix_enabled BOOLEAN NOT NULL DEFAULT true,
        card_enabled BOOLEAN NOT NULL DEFAULT false,
        implantacao_enabled BOOLEAN NOT NULL DEFAULT true,
        implantacao_price NUMERIC(10,2) NOT NULL DEFAULT 400,
        plano_price NUMERIC(10,2) NOT NULL DEFAULT 390,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await qr.query(`
      INSERT INTO checkout_settings (id, pix_enabled, card_enabled, implantacao_enabled, implantacao_price, plano_price)
      VALUES (1, true, false, true, 400, 390)
      ON CONFLICT (id) DO NOTHING
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS checkout_settings`);
  }
}
