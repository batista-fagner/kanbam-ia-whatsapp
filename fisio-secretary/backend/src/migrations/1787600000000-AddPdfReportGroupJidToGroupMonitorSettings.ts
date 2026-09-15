import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPdfReportGroupJidToGroupMonitorSettings1787600000000 implements MigrationInterface {
  name = 'AddPdfReportGroupJidToGroupMonitorSettings1787600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "group_monitor_settings"
      ADD COLUMN "pdf_report_group_jid" varchar
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "group_monitor_settings"
      DROP COLUMN "pdf_report_group_jid"
    `);
  }
}
