import { MigrationInterface, QueryRunner } from "typeorm";

export class AddFollowupCadence1784775618371 implements MigrationInterface {
    name = 'AddFollowupCadence1784775618371'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "whatsapp_config" ADD "followup_cadence" jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "whatsapp_config" DROP COLUMN "followup_cadence"`);
    }

}
