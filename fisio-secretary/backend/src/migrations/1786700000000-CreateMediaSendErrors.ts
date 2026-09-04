import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateMediaSendErrors1786700000000 implements MigrationInterface {
    name = 'CreateMediaSendErrors1786700000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "media_send_errors" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "tenant_id" uuid NOT NULL, "phone" character varying, "media_name" character varying, "reason" character varying NOT NULL, "error_message" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_media_send_errors_id" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_media_send_errors_tenant_created" ON "media_send_errors" ("tenant_id", "created_at")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_media_send_errors_tenant_created"`);
        await queryRunner.query(`DROP TABLE "media_send_errors"`);
    }
}
