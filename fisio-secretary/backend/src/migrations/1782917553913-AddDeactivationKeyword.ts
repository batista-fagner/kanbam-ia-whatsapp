import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDeactivationKeyword1782917553913 implements MigrationInterface {
    name = 'AddDeactivationKeyword1782917553913'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "whatsapp_config" ADD "deactivation_keyword" character varying NOT NULL DEFAULT 'opa'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "whatsapp_config" DROP COLUMN "deactivation_keyword"`);
    }

}
