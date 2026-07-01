import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMultiAgentEnabled1781200000000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE whatsapp_config
      ADD COLUMN IF NOT EXISTS multi_agent_enabled BOOLEAN NOT NULL DEFAULT false
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE whatsapp_config DROP COLUMN IF EXISTS multi_agent_enabled`);
  }
}
