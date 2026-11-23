import { MigrationInterface, QueryRunner } from "typeorm";

// Serviço de tráfego pago no checkout: liga/desliga + valor nas configurações, e a cobrança
// reaproveita implantacao_payments (cobrança avulsa paga antes/sem conta) com um "kind" e o
// QR/código guardados para a página pública /pix/:txid.
export class AddTrafegoCheckout1789200000000 implements MigrationInterface {
    name = 'AddTrafegoCheckout1789200000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "checkout_settings" ADD "trafego_enabled" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "checkout_settings" ADD "trafego_price" numeric(10,2) NOT NULL DEFAULT 1500`);
        await queryRunner.query(`ALTER TABLE "implantacao_payments" ADD "kind" character varying NOT NULL DEFAULT 'implantacao'`);
        await queryRunner.query(`ALTER TABLE "implantacao_payments" ADD "pix_txid" character varying`);
        await queryRunner.query(`ALTER TABLE "implantacao_payments" ADD "pix_qr_code" text`);
        await queryRunner.query(`ALTER TABLE "implantacao_payments" ADD "pix_code" text`);
        await queryRunner.query(`CREATE INDEX "IDX_implantacao_payments_pix_txid" ON "implantacao_payments" ("pix_txid")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_implantacao_payments_pix_txid"`);
        await queryRunner.query(`ALTER TABLE "implantacao_payments" DROP COLUMN "pix_code"`);
        await queryRunner.query(`ALTER TABLE "implantacao_payments" DROP COLUMN "pix_qr_code"`);
        await queryRunner.query(`ALTER TABLE "implantacao_payments" DROP COLUMN "pix_txid"`);
        await queryRunner.query(`ALTER TABLE "implantacao_payments" DROP COLUMN "kind"`);
        await queryRunner.query(`ALTER TABLE "checkout_settings" DROP COLUMN "trafego_price"`);
        await queryRunner.query(`ALTER TABLE "checkout_settings" DROP COLUMN "trafego_enabled"`);
    }
}
