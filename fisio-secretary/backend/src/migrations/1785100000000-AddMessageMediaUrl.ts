import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMessageMediaUrl1785100000000 implements MigrationInterface {
    name = 'AddMessageMediaUrl1785100000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "media_url" text`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN IF EXISTS "media_url"`);
    }
}
