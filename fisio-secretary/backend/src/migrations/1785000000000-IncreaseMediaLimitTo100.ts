import { MigrationInterface, QueryRunner } from "typeorm";

export class IncreaseMediaLimitTo1001785000000 implements MigrationInterface {
    name = 'IncreaseMediaLimitTo1001785000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "whatsapp_config" ALTER COLUMN "media_limit_per_day" SET DEFAULT 100`);
        await queryRunner.query(`UPDATE "whatsapp_config" SET "media_limit_per_day" = 100 WHERE "media_limit_per_day" <= 41`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "whatsapp_config" ALTER COLUMN "media_limit_per_day" SET DEFAULT 41`);
        await queryRunner.query(`UPDATE "whatsapp_config" SET "media_limit_per_day" = 41 WHERE "media_limit_per_day" = 100`);
    }
}
