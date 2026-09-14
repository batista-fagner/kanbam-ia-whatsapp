import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateGroupMessages1787200000000 implements MigrationInterface {
    name = 'CreateGroupMessages1787200000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "group_messages" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "tenant_id" uuid NOT NULL, "group_jid" character varying NOT NULL, "sender_phone" character varying, "sender_name" character varying, "sender_role" character varying NOT NULL DEFAULT 'unknown', "message_type" character varying NOT NULL DEFAULT 'text', "content" text NOT NULL, "external_message_id" character varying, "risk_flagged" boolean NOT NULL DEFAULT false, "risk_reason" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_group_messages_id" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_group_messages_tenant_created" ON "group_messages" ("tenant_id", "created_at")`);
        await queryRunner.query(`CREATE INDEX "IDX_group_messages_group_created" ON "group_messages" ("group_jid", "created_at")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_group_messages_group_created"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_group_messages_tenant_created"`);
        await queryRunner.query(`DROP TABLE "group_messages"`);
    }
}
