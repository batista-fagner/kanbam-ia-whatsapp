import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMediaLimitPerDay1780900000000 implements MigrationInterface {
  name = 'AddMediaLimitPerDay1780900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "whatsapp_config" ADD "media_limit_per_day" integer NOT NULL DEFAULT 41`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "whatsapp_config" DROP COLUMN "media_limit_per_day"`
    );
  }
}
