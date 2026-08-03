import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateGeneratedPrompts1785900000000 implements MigrationInterface {
    name = 'CreateGeneratedPrompts1785900000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "generated_prompts" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "tenant_id" uuid NOT NULL,
                "reference_tenant_id" uuid,
                "source_form_id" uuid,
                "content" text NOT NULL,
                "status" character varying NOT NULL DEFAULT 'draft',
                "created_at" timestamp NOT NULL DEFAULT now(),
                "updated_at" timestamp NOT NULL DEFAULT now(),
                CONSTRAINT "PK_generated_prompts" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_generated_prompts_tenant" ON "generated_prompts" ("tenant_id")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "generated_prompts"`);
    }
}
