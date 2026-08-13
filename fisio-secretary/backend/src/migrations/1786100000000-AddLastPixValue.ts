import { MigrationInterface, QueryRunner } from "typeorm";

export class AddLastPixValue1786100000000 implements MigrationInterface {
    name = 'AddLastPixValue1786100000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "whatsapp_config" ADD "last_pix_value" numeric(10,2)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "whatsapp_config" DROP COLUMN "last_pix_value"`);
    }
}
