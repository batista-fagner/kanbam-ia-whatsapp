import { MigrationInterface, QueryRunner } from 'typeorm';

// Relatório de vendas por IA (piloto DALU). O índice único parcial impede dois relatórios
// "processing" ao mesmo tempo pro mesmo cliente (duplo clique / duas abas).
export class CreateSalesReports1788700000000 implements MigrationInterface {
  name = 'CreateSalesReports1788700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "sales_reports" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "period_start" TIMESTAMP NOT NULL,
        "period_end" TIMESTAMP NOT NULL,
        "status" varchar NOT NULL DEFAULT 'processing',
        "content" jsonb NULL,
        "metrics" jsonb NULL,
        "error" text NULL,
        "model" varchar NULL,
        "input_tokens" int NOT NULL DEFAULT 0,
        "cached_tokens" int NOT NULL DEFAULT 0,
        "output_tokens" int NOT NULL DEFAULT 0,
        "cost_usd" numeric(10,6) NOT NULL DEFAULT 0,
        "pdf_sent_to" varchar NULL,
        "pdf_error" text NULL,
        "created_by" uuid NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_sales_reports" PRIMARY KEY ("id"),
        CONSTRAINT "FK_sales_reports_tenant" FOREIGN KEY ("tenant_id") REFERENCES "whatsapp_config"("id") ON DELETE CASCADE
      )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_sales_reports_tenant_created" ON "sales_reports" ("tenant_id", "created_at")`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_sales_reports_one_processing" ON "sales_reports" ("tenant_id") WHERE "status" = 'processing'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "sales_reports"`);
  }
}
