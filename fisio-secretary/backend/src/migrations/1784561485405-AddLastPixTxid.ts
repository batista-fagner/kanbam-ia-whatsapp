import { MigrationInterface, QueryRunner } from "typeorm";

export class AddLastPixTxid1784561485405 implements MigrationInterface {
    name = 'AddLastPixTxid1784561485405'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "whatsapp_config" ADD "last_pix_txid" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "whatsapp_config" DROP COLUMN "last_pix_txid"`);
    }
}
