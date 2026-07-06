import { MigrationInterface, QueryRunner } from 'typeorm';

// Separa o gasto de token por motor (monolith x multi_agent) — necessário pra
// comparar custo durante a migração gradual dos tenants pro multi-agente.
// Troca a constraint única de (tenant_id, date) pra (tenant_id, date, engine).
export class AddTokenUsageEngine1784100000000 implements MigrationInterface {
  name = 'AddTokenUsageEngine1784100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "token_usage" ADD COLUMN IF NOT EXISTS "engine" character varying NOT NULL DEFAULT 'monolith'`);
    await queryRunner.query(`ALTER TABLE "token_usage" DROP CONSTRAINT IF EXISTS "UQ_token_usage_tenant_date"`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_token_usage_tenant_date_engine" ON "token_usage" ("tenant_id", "date", "engine")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_token_usage_tenant_date_engine"`);
    await queryRunner.query(`ALTER TABLE "token_usage" ADD CONSTRAINT "UQ_token_usage_tenant_date" UNIQUE ("tenant_id", "date")`);
    await queryRunner.query(`ALTER TABLE "token_usage" DROP COLUMN IF EXISTS "engine"`);
  }
}
