import { MigrationInterface, QueryRunner } from "typeorm";

export class AddLastPixQrCodeAndCode1786000000000 implements MigrationInterface {
    name = 'AddLastPixQrCodeAndCode1786000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "whatsapp_config" ADD "last_pix_qr_code" text`);
        await queryRunner.query(`ALTER TABLE "whatsapp_config" ADD "last_pix_code" text`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "whatsapp_config" DROP COLUMN "last_pix_code"`);
        await queryRunner.query(`ALTER TABLE "whatsapp_config" DROP COLUMN "last_pix_qr_code"`);
    }
}
