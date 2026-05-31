import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1780170753448 implements MigrationInterface {
    name = 'InitialSchema1780170753448'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "messages" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "conversation_id" uuid NOT NULL, "evolution_id" character varying, "direction" character varying NOT NULL, "sender" character varying NOT NULL, "content" text NOT NULL, "message_type" character varying NOT NULL DEFAULT 'text', "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_18325f38ae6de43878487eff986" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "conversations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "lead_id" uuid NOT NULL, "ai_enabled" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "REL_5c73048f6ad3d937f15765df49" UNIQUE ("lead_id"), CONSTRAINT "PK_ee34f4f7ced4ec8681f26bf04ef" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "lead_stage_history" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "lead_id" uuid NOT NULL, "from_stage" character varying, "to_stage" character varying NOT NULL, "changed_by" character varying NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_6ebac189e9a4076af51ae92ee30" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "leads" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid, "phone" character varying NOT NULL, "name" character varying, "stage" character varying NOT NULL DEFAULT 'novo_lead', "temperature" character varying, "qualification_score" integer NOT NULL DEFAULT '0', "symptoms" text, "urgency" character varying, "availability" character varying, "budget" character varying, "observations" text, "qualification_step" integer NOT NULL DEFAULT '0', "ai_context" jsonb NOT NULL DEFAULT '[]', "nurture_step" integer NOT NULL DEFAULT '0', "nurture_paused" boolean NOT NULL DEFAULT false, "next_nurture_at" TIMESTAMP, "appointment_at" TIMESTAMP, "calendar_event_id" text, "calendar_event_link" text, "last_message_at" TIMESTAMP, "last_message_direction" character varying, "labels" jsonb NOT NULL DEFAULT '[]', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_42ebb4366d014febbcfdef39e36" UNIQUE ("phone"), CONSTRAINT "PK_cd102ed7a9a4ca7d4d8bfeba406" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "campaigns" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid, "campaign_name" character varying NOT NULL, "message" text NOT NULL, "mode" character varying NOT NULL, "total_recipients" integer NOT NULL DEFAULT '0', "folder_id" character varying, "status" character varying NOT NULL DEFAULT 'sending', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_831e3fcd4fc45b4e4c3f57a9ee4" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "whatsapp_config" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "instance_token" character varying, "profile_name" character varying, "phone" character varying, "profile_pic_url" text, "connected" boolean NOT NULL DEFAULT false, "webhook_configured" boolean NOT NULL DEFAULT false, "webhook_url" text, "agent_type" character varying NOT NULL DEFAULT 'fisio', "custom_prompt_sofia" text, "custom_prompt_megahair" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_26b345257d5e690dcef84c61550" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "media_files" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid, "name" character varying NOT NULL, "url" text NOT NULL, "storage_path" text NOT NULL, "mime_type" character varying, "size" integer, "reel_codes" text array DEFAULT '{}', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_6b1fd78e98f0917d51656759a94" UNIQUE ("name"), CONSTRAINT "PK_93b4da6741cd150e76f9ac035d8" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "appointments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid, "lead_id" uuid, "client_name" character varying NOT NULL, "client_phone" character varying, "service" character varying NOT NULL DEFAULT 'mega_hair', "value" numeric(10,2), "status" character varying NOT NULL DEFAULT 'agendado', "start_date_time" TIMESTAMP NOT NULL, "notes" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_4a437a9a27e948726b8bb3e36ad" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "deleted_leads" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid, "original_lead_id" uuid NOT NULL, "phone" character varying NOT NULL, "name" character varying, "stage" character varying, "deletion_reason" text NOT NULL, "lead_snapshot" jsonb NOT NULL, "deleted_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_6bb1301b439cd9a88ee6d9d87f6" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying NOT NULL, "password_hash" text NOT NULL, "name" character varying, "tenant_id" uuid, "role" character varying NOT NULL DEFAULT 'operator', "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "messages" ADD CONSTRAINT "FK_3bc55a7c3f9ed54b520bb5cfe23" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "conversations" ADD CONSTRAINT "FK_5c73048f6ad3d937f15765df499" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "lead_stage_history" ADD CONSTRAINT "FK_7ccb06ed0cc52d31646fc7490e4" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "appointments" ADD CONSTRAINT "FK_ddc04961a048845432b04a735d9" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "appointments" DROP CONSTRAINT "FK_ddc04961a048845432b04a735d9"`);
        await queryRunner.query(`ALTER TABLE "lead_stage_history" DROP CONSTRAINT "FK_7ccb06ed0cc52d31646fc7490e4"`);
        await queryRunner.query(`ALTER TABLE "conversations" DROP CONSTRAINT "FK_5c73048f6ad3d937f15765df499"`);
        await queryRunner.query(`ALTER TABLE "messages" DROP CONSTRAINT "FK_3bc55a7c3f9ed54b520bb5cfe23"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP TABLE "deleted_leads"`);
        await queryRunner.query(`DROP TABLE "appointments"`);
        await queryRunner.query(`DROP TABLE "media_files"`);
        await queryRunner.query(`DROP TABLE "whatsapp_config"`);
        await queryRunner.query(`DROP TABLE "campaigns"`);
        await queryRunner.query(`DROP TABLE "leads"`);
        await queryRunner.query(`DROP TABLE "lead_stage_history"`);
        await queryRunner.query(`DROP TABLE "conversations"`);
        await queryRunner.query(`DROP TABLE "messages"`);
    }

}
