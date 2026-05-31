import { MigrationInterface, QueryRunner } from "typeorm";

export class ClientManagement1780184764189 implements MigrationInterface {
    name = 'ClientManagement1780184764189'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "whatsapp_config" ADD "display_name" character varying`);
        await queryRunner.query(`ALTER TABLE "whatsapp_config" ADD "is_active" boolean NOT NULL DEFAULT true`);
        await queryRunner.query(`ALTER TABLE "whatsapp_config" ADD "next_payment_date" date`);
        await queryRunner.query(`ALTER TABLE "whatsapp_config" ADD "billing_phone" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "whatsapp_config" DROP COLUMN "billing_phone"`);
        await queryRunner.query(`ALTER TABLE "whatsapp_config" DROP COLUMN "next_payment_date"`);
        await queryRunner.query(`ALTER TABLE "whatsapp_config" DROP COLUMN "is_active"`);
        await queryRunner.query(`ALTER TABLE "whatsapp_config" DROP COLUMN "display_name"`);
    }

}
