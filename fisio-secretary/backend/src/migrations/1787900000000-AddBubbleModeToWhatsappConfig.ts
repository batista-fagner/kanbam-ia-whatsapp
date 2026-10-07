import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBubbleModeToWhatsappConfig1787900000000 implements MigrationInterface {
  name = 'AddBubbleModeToWhatsappConfig1787900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "whatsapp_config" ADD "bubble_mode" boolean NOT NULL DEFAULT false`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "whatsapp_config" DROP COLUMN "bubble_mode"`);
  }
}
