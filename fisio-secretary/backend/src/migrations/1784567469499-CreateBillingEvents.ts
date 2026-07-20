import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateBillingEvents1784567469499 implements MigrationInterface {
    name = 'CreateBillingEvents1784567469499'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "billing_events" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "tenant_id" uuid NOT NULL, "channel" character varying NOT NULL, "status" character varying NOT NULL, "amount" numeric(10,2), "txid" character varying, "error_message" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_9a4a4a1b1f55bbc868f6a76a597" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_cc8af13f9f0eec1b388e430fe5" ON "billing_events" ("tenant_id", "created_at") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_cc8af13f9f0eec1b388e430fe5"`);
        await queryRunner.query(`DROP TABLE "billing_events"`);
    }
}
