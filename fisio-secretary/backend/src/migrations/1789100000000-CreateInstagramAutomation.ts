import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateInstagramAutomation1789100000000 implements MigrationInterface {
    name = 'CreateInstagramAutomation1789100000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "instagram_accounts" (
            "id" uuid NOT NULL DEFAULT gen_random_uuid(),
            "tenant_id" uuid NOT NULL,
            "ig_user_id" character varying NOT NULL,
            "username" character varying,
            "token_enc" text NOT NULL,
            "token_refreshed_at" TIMESTAMP NOT NULL,
            "token_expires_at" TIMESTAMP,
            "active" boolean NOT NULL DEFAULT true,
            "last_error" text,
            "whatsapp_phone" character varying,
            "dm_enabled" boolean NOT NULL DEFAULT false,
            "dm_text" text NOT NULL DEFAULT '',
            "dm_button_label" character varying NOT NULL DEFAULT 'Falar no WhatsApp',
            "dm_whatsapp_text" character varying NOT NULL DEFAULT 'Oi! Vim pelo Instagram 😊',
            "cooldown_hours" integer NOT NULL DEFAULT 24,
            "created_at" TIMESTAMP NOT NULL DEFAULT now(),
            "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
            CONSTRAINT "PK_instagram_accounts_id" PRIMARY KEY ("id"),
            CONSTRAINT "FK_instagram_accounts_tenant" FOREIGN KEY ("tenant_id") REFERENCES "whatsapp_config"("id") ON DELETE CASCADE
        )`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_instagram_accounts_tenant" ON "instagram_accounts" ("tenant_id")`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_instagram_accounts_ig_user" ON "instagram_accounts" ("ig_user_id")`);

        await queryRunner.query(`CREATE TABLE "instagram_automations" (
            "id" uuid NOT NULL DEFAULT gen_random_uuid(),
            "tenant_id" uuid NOT NULL,
            "post_id" character varying NOT NULL,
            "post_caption" text,
            "post_thumbnail" text,
            "post_permalink" character varying,
            "trigger_mode" character varying NOT NULL DEFAULT 'keyword',
            "keywords" text NOT NULL DEFAULT '',
            "comment_reply" text,
            "dm_text" text NOT NULL,
            "button_label" character varying NOT NULL DEFAULT 'Falar no WhatsApp',
            "whatsapp_phone" character varying,
            "whatsapp_text" character varying NOT NULL DEFAULT 'Oi! Vim pelo Instagram 😊',
            "active" boolean NOT NULL DEFAULT true,
            "triggered_count" integer NOT NULL DEFAULT 0,
            "created_at" TIMESTAMP NOT NULL DEFAULT now(),
            "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
            CONSTRAINT "PK_instagram_automations_id" PRIMARY KEY ("id"),
            CONSTRAINT "FK_instagram_automations_tenant" FOREIGN KEY ("tenant_id") REFERENCES "whatsapp_config"("id") ON DELETE CASCADE
        )`);
        await queryRunner.query(`CREATE INDEX "IDX_instagram_automations_tenant" ON "instagram_automations" ("tenant_id")`);

        await queryRunner.query(`CREATE TABLE "instagram_events" (
            "id" uuid NOT NULL DEFAULT gen_random_uuid(),
            "tenant_id" uuid NOT NULL,
            "kind" character varying NOT NULL,
            "external_id" character varying NOT NULL,
            "sender_ig_id" character varying NOT NULL,
            "sender_username" character varying,
            "post_id" character varying,
            "text" text NOT NULL DEFAULT '',
            "automation_id" uuid,
            "action" character varying NOT NULL DEFAULT 'received',
            "error" text,
            "created_at" TIMESTAMP NOT NULL DEFAULT now(),
            CONSTRAINT "PK_instagram_events_id" PRIMARY KEY ("id"),
            CONSTRAINT "FK_instagram_events_tenant" FOREIGN KEY ("tenant_id") REFERENCES "whatsapp_config"("id") ON DELETE CASCADE
        )`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_instagram_events_external" ON "instagram_events" ("external_id")`);
        await queryRunner.query(`CREATE INDEX "IDX_instagram_events_tenant_created" ON "instagram_events" ("tenant_id", "created_at")`);
        await queryRunner.query(`CREATE INDEX "IDX_instagram_events_sender" ON "instagram_events" ("tenant_id", "sender_ig_id", "created_at")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "instagram_events"`);
        await queryRunner.query(`DROP TABLE "instagram_automations"`);
        await queryRunner.query(`DROP TABLE "instagram_accounts"`);
    }
}
