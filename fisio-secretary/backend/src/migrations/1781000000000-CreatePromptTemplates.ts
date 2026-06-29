import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePromptTemplates1781000000000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE prompt_templates (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name        VARCHAR(200) NOT NULL,
        description VARCHAR(500),
        content     TEXT NOT NULL DEFAULT '',
        agent_type  VARCHAR(50),
        created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS prompt_templates`);
  }
}
