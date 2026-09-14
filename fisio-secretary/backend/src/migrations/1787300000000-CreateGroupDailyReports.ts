import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateGroupDailyReports1787300000000 implements MigrationInterface {
    name = 'CreateGroupDailyReports1787300000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "group_daily_reports" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "tenant_id" uuid NOT NULL, "group_jid" character varying NOT NULL, "report_date" date NOT NULL, "message_count" integer NOT NULL DEFAULT 0, "summary" text NOT NULL, "sentiment" character varying NOT NULL, "doubt_categories" jsonb NOT NULL DEFAULT '[]'::jsonb, "opportunity_signal" boolean NOT NULL DEFAULT false, "opportunity_note" text, "raw_json" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_group_daily_reports_id" PRIMARY KEY ("id"), CONSTRAINT "UQ_group_daily_reports_tenant_date" UNIQUE ("tenant_id", "report_date"))`);
        await queryRunner.query(`CREATE INDEX "IDX_group_daily_reports_date" ON "group_daily_reports" ("report_date")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_group_daily_reports_date"`);
        await queryRunner.query(`DROP TABLE "group_daily_reports"`);
    }
}
