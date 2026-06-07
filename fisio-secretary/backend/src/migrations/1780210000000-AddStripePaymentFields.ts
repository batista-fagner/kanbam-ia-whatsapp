import { MigrationInterface, QueryRunner } from "typeorm";

export class AddStripePaymentFields1780210000000 implements MigrationInterface {
    name = 'AddStripePaymentFields1780210000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "whatsapp_config" ADD "stripe_customer_id" character varying`);
        await queryRunner.query(`ALTER TABLE "whatsapp_config" ADD "stripe_subscription_id" character varying`);
        await queryRunner.query(`ALTER TABLE "whatsapp_config" ADD "payment_method" character varying NOT NULL DEFAULT 'manual'`);
        await queryRunner.query(`ALTER TABLE "whatsapp_config" ADD "plan_status" character varying NOT NULL DEFAULT 'active'`);
        await queryRunner.query(`ALTER TABLE "whatsapp_config" ADD "last_pix_sent_at" date`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "whatsapp_config" DROP COLUMN "last_pix_sent_at"`);
        await queryRunner.query(`ALTER TABLE "whatsapp_config" DROP COLUMN "plan_status"`);
        await queryRunner.query(`ALTER TABLE "whatsapp_config" DROP COLUMN "payment_method"`);
        await queryRunner.query(`ALTER TABLE "whatsapp_config" DROP COLUMN "stripe_subscription_id"`);
        await queryRunner.query(`ALTER TABLE "whatsapp_config" DROP COLUMN "stripe_customer_id"`);
    }
}
