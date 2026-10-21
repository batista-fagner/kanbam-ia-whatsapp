import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTestOnlyPhoneToWhatsappConfig1788300000000 implements MigrationInterface {
  name = 'AddTestOnlyPhoneToWhatsappConfig1788300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "whatsapp_config" ADD "test_only_phone" character varying`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "whatsapp_config" DROP COLUMN "test_only_phone"`);
  }
}
