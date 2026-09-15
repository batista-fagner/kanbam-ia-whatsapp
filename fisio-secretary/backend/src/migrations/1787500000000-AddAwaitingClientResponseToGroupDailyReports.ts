import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAwaitingClientResponseToGroupDailyReports1787500000000 implements MigrationInterface {
  name = 'AddAwaitingClientResponseToGroupDailyReports1787500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "group_daily_reports"
      ADD COLUMN "awaiting_client_response" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "group_daily_reports"
      DROP COLUMN "awaiting_client_response"
    `);
  }
}
