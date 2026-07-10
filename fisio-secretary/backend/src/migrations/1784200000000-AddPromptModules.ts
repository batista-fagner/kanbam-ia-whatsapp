import { MigrationInterface, QueryRunner } from 'typeorm';

// Arquitetura "agente único + módulos dinâmicos" (protótipo, ver PromptModule).
// Tabela nova, isolada — não mexe em agents/whatsapp_config existentes além do
// campo prompt_engine, que é aditivo (default 'legacy' preserva 100% do
// comportamento atual pra todo tenant).
export class AddPromptModules1784200000000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE IF NOT EXISTS prompt_modules (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        name VARCHAR(120) NOT NULL,
        is_core BOOLEAN NOT NULL DEFAULT false,
        keywords TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        is_active BOOLEAN NOT NULL DEFAULT true,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        updated_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await qr.query(`CREATE INDEX IF NOT EXISTS idx_prompt_modules_tenant_id ON prompt_modules (tenant_id)`);
    await qr.query(`ALTER TABLE whatsapp_config ADD COLUMN IF NOT EXISTS prompt_engine VARCHAR(30) NOT NULL DEFAULT 'legacy'`);
    await qr.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS active_modules JSONB NOT NULL DEFAULT '[]'`);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE leads DROP COLUMN IF EXISTS active_modules`);
    await qr.query(`ALTER TABLE whatsapp_config DROP COLUMN IF EXISTS prompt_engine`);
    await qr.query(`DROP INDEX IF EXISTS idx_prompt_modules_tenant_id`);
    await qr.query(`DROP TABLE IF EXISTS prompt_modules`);
  }
}
