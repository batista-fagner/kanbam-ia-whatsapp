import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgents1781100000000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE agents (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id     UUID NOT NULL REFERENCES whatsapp_config(id) ON DELETE CASCADE,
        name          VARCHAR(120) NOT NULL,
        description   VARCHAR(500) NOT NULL DEFAULT '',
        responds_to   TEXT NOT NULL DEFAULT '',
        handoff_when  TEXT NOT NULL DEFAULT '',
        system_prompt TEXT NOT NULL DEFAULT '',
        is_active     BOOLEAN NOT NULL DEFAULT false,
        is_default    BOOLEAN NOT NULL DEFAULT false,
        sort_order    INTEGER NOT NULL DEFAULT 0,
        created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await qr.query(`CREATE INDEX idx_agents_tenant ON agents(tenant_id)`);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS agents`);
  }
}
