import { MigrationInterface, QueryRunner } from "typeorm";

export class AddArchivedAtToWhatsappConfig1787800000000 implements MigrationInterface {
    name = 'AddArchivedAtToWhatsappConfig1787800000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "whatsapp_config" ADD "archived_at" TIMESTAMP`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "whatsapp_config" DROP COLUMN "archived_at"`);
    }
}
