import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateOnboardingForms1785800000000 implements MigrationInterface {
    name = 'CreateOnboardingForms1785800000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "onboarding_forms" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "tenant_id" uuid,
                "email" character varying,
                "answers" jsonb NOT NULL,
                "created_at" timestamp NOT NULL DEFAULT now(),
                CONSTRAINT "PK_onboarding_forms" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`ALTER TABLE "whatsapp_config" ADD COLUMN IF NOT EXISTS "prompt_form_submitted_at" timestamp`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "whatsapp_config" DROP COLUMN IF EXISTS "prompt_form_submitted_at"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "onboarding_forms"`);
    }
}
