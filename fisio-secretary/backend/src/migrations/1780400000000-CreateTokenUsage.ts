import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTokenUsage1780400000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "token_usage" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "date" date NOT NULL,
        "input_tokens" integer NOT NULL DEFAULT 0,
        "cached_tokens" integer NOT NULL DEFAULT 0,
        "output_tokens" integer NOT NULL DEFAULT 0,
        "cost_usd" numeric(10,8) NOT NULL DEFAULT 0,
        CONSTRAINT "PK_token_usage" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_token_usage_tenant_date" UNIQUE ("tenant_id", "date")
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "token_usage"`);
  }
}
