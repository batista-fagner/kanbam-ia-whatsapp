import { MigrationInterface, QueryRunner } from "typeorm";

export class AddActivationKeyword1783278000312 implements MigrationInterface {
    name = 'AddActivationKeyword1783278000312'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "whatsapp_config" ADD "activation_keyword" character varying NOT NULL DEFAULT 'volta'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "whatsapp_config" DROP COLUMN "activation_keyword"`);
    }

}
