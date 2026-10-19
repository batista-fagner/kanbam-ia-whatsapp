import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateClientForms1788000000000 implements MigrationInterface {
  name = 'CreateClientForms1788000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "client_forms" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "form_key" character varying NOT NULL,
        "token" character varying NOT NULL,
        "answers" jsonb NOT NULL DEFAULT '{}',
        "files" jsonb NOT NULL DEFAULT '[]',
        "submitted_at" TIMESTAMP,
        "onboarding_form_id" uuid,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_client_forms_token" UNIQUE ("token"),
        CONSTRAINT "PK_client_forms" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_client_forms_tenant" ON "client_forms" ("tenant_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_client_forms_tenant"`);
    await queryRunner.query(`DROP TABLE "client_forms"`);
  }
}
