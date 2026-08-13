import { MigrationInterface, QueryRunner } from "typeorm";

export class ChangeLastPixSentAtToTimestamp1786200000000 implements MigrationInterface {
    name = 'ChangeLastPixSentAtToTimestamp1786200000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "whatsapp_config" ALTER COLUMN "last_pix_sent_at" TYPE timestamp`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "whatsapp_config" ALTER COLUMN "last_pix_sent_at" TYPE date`);
    }
}
