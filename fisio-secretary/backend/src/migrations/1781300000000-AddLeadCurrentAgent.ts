import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLeadCurrentAgent1781300000000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE leads
      ADD COLUMN IF NOT EXISTS current_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE leads DROP COLUMN IF EXISTS current_agent_id`);
  }
}
