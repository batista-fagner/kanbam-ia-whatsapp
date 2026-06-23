import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMediaCaption1780600000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE media_files ADD COLUMN IF NOT EXISTS caption text`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE media_files DROP COLUMN IF EXISTS caption`);
  }
}
