import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAutoFollowupEnabled1785788276436 implements MigrationInterface {
    name = 'AddAutoFollowupEnabled1785788276436'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "whatsapp_config" ADD "auto_followup_enabled" boolean NOT NULL DEFAULT true`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "whatsapp_config" DROP COLUMN "auto_followup_enabled"`);
    }

}
