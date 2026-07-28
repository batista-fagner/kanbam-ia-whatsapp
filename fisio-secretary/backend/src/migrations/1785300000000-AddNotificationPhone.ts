import { MigrationInterface, QueryRunner } from "typeorm";

export class AddNotificationPhone1785300000000 implements MigrationInterface {
    name = 'AddNotificationPhone1785300000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "whatsapp_config" ADD COLUMN IF NOT EXISTS "notification_phone" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "whatsapp_config" DROP COLUMN IF EXISTS "notification_phone"`);
    }
}
