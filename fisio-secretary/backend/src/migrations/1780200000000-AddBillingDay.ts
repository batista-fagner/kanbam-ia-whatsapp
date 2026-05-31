import { MigrationInterface, QueryRunner } from "typeorm";

export class AddBillingDay1780200000000 implements MigrationInterface {
    name = 'AddBillingDay1780200000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "whatsapp_config" ADD "billing_day" integer`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "whatsapp_config" DROP COLUMN "billing_day"`);
    }
}
