import { MigrationInterface, QueryRunner } from "typeorm";

export class AddFollowupLimitPerDay1782932396574 implements MigrationInterface {
    name = 'AddFollowupLimitPerDay1782932396574'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "whatsapp_config" ADD "followup_limit_per_day" integer NOT NULL DEFAULT 40`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "whatsapp_config" DROP COLUMN "followup_limit_per_day"`);
    }

}
