import { MigrationInterface, QueryRunner } from 'typeorm';

// Agenda com profissionais e serviços (piloto DALU). Tudo opcional: tenants sem
// tenant_schedules.mode='professionals' continuam exatamente como antes.
export class CreateAgendaPro1788100000000 implements MigrationInterface {
  name = 'CreateAgendaPro1788100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "agenda_professionals" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "name" character varying NOT NULL,
        "color" character varying NOT NULL DEFAULT '#0d9488',
        "whatsapp" character varying,
        "notify" boolean NOT NULL DEFAULT true,
        "active" boolean NOT NULL DEFAULT true,
        "sort_order" integer NOT NULL DEFAULT 0,
        "weekly_hours" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agenda_professionals" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_agenda_professionals_tenant" ON "agenda_professionals" ("tenant_id")`);
    await queryRunner.query(`
      CREATE TABLE "agenda_services" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "name" character varying NOT NULL,
        "duration_minutes" integer NOT NULL DEFAULT 60,
        "price" numeric(10,2),
        "price_note" character varying,
        "active" boolean NOT NULL DEFAULT true,
        "sort_order" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agenda_services" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_agenda_services_tenant" ON "agenda_services" ("tenant_id")`);
    await queryRunner.query(`
      CREATE TABLE "agenda_professional_services" (
        "professional_id" uuid NOT NULL REFERENCES "agenda_professionals"("id") ON DELETE CASCADE,
        "service_id" uuid NOT NULL REFERENCES "agenda_services"("id") ON DELETE CASCADE,
        CONSTRAINT "PK_agenda_professional_services" PRIMARY KEY ("professional_id", "service_id")
      )
    `);
    await queryRunner.query(`ALTER TABLE "appointments" ADD "professional_id" uuid`);
    await queryRunner.query(`ALTER TABLE "appointments" ADD "service_id" uuid`);
    await queryRunner.query(`ALTER TABLE "appointments" ADD "source" character varying`);
    await queryRunner.query(`CREATE INDEX "IDX_appointments_professional_start" ON "appointments" ("professional_id", "start_date_time")`);
    await queryRunner.query(`ALTER TABLE "schedule_blocks" ADD "professional_id" uuid`);
    await queryRunner.query(`ALTER TABLE "tenant_schedules" ADD "mode" character varying NOT NULL DEFAULT 'simple'`);
    await queryRunner.query(`ALTER TABLE "leads" ADD "agenda_state" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "leads" DROP COLUMN "agenda_state"`);
    await queryRunner.query(`ALTER TABLE "tenant_schedules" DROP COLUMN "mode"`);
    await queryRunner.query(`ALTER TABLE "schedule_blocks" DROP COLUMN "professional_id"`);
    await queryRunner.query(`DROP INDEX "IDX_appointments_professional_start"`);
    await queryRunner.query(`ALTER TABLE "appointments" DROP COLUMN "source"`);
    await queryRunner.query(`ALTER TABLE "appointments" DROP COLUMN "service_id"`);
    await queryRunner.query(`ALTER TABLE "appointments" DROP COLUMN "professional_id"`);
    await queryRunner.query(`DROP TABLE "agenda_professional_services"`);
    await queryRunner.query(`DROP INDEX "IDX_agenda_services_tenant"`);
    await queryRunner.query(`DROP TABLE "agenda_services"`);
    await queryRunner.query(`DROP INDEX "IDX_agenda_professionals_tenant"`);
    await queryRunner.query(`DROP TABLE "agenda_professionals"`);
  }
}
