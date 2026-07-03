import { MigrationInterface, QueryRunner } from 'typeorm';

// Capacidades por agente (multi-agente): controlam a montagem condicional do
// prompt. Default true preserva o comportamento atual de todos os agentes.
export class AddAgentCapabilities1783000000000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS can_schedule   BOOLEAN NOT NULL DEFAULT true`);
    await qr.query(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS can_send_media BOOLEAN NOT NULL DEFAULT true`);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE agents DROP COLUMN IF EXISTS can_send_media`);
    await qr.query(`ALTER TABLE agents DROP COLUMN IF EXISTS can_schedule`);
  }
}
