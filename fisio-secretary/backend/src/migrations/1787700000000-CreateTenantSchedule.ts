import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateTenantSchedule1787700000000 implements MigrationInterface {
    name = 'CreateTenantSchedule1787700000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "tenant_schedules" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "tenant_id" uuid NOT NULL, "enabled" boolean NOT NULL DEFAULT false, "slot_minutes" integer NOT NULL DEFAULT 60, "capacity" integer NOT NULL DEFAULT 1, "booking_window_days" integer NOT NULL DEFAULT 14, "min_notice_hours" integer NOT NULL DEFAULT 2, "weekly_hours" jsonb NOT NULL DEFAULT '{}'::jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_tenant_schedules_id" PRIMARY KEY ("id"), CONSTRAINT "UQ_tenant_schedules_tenant_id" UNIQUE ("tenant_id"))`);

        await queryRunner.query(`CREATE TABLE "schedule_blocks" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "tenant_id" uuid NOT NULL, "start_date_time" TIMESTAMP NOT NULL, "end_date_time" TIMESTAMP NOT NULL, "reason" character varying, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_schedule_blocks_id" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_schedule_blocks_tenant_start" ON "schedule_blocks" ("tenant_id", "start_date_time")`);

        await queryRunner.query(`ALTER TABLE "appointments" ADD "end_date_time" TIMESTAMP`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "appointments" DROP COLUMN "end_date_time"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_schedule_blocks_tenant_start"`);
        await queryRunner.query(`DROP TABLE "schedule_blocks"`);
        await queryRunner.query(`DROP TABLE "tenant_schedules"`);
    }
}
