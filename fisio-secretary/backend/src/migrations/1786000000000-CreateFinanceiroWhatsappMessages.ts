import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateFinanceiroWhatsappMessages1786000000000 implements MigrationInterface {
    name = 'CreateFinanceiroWhatsappMessages1786000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "financeiro_whatsapp_messages" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "phone" character varying NOT NULL,
                "direction" character varying NOT NULL,
                "content" text NOT NULL,
                "client_name" character varying,
                "tenant_id" uuid,
                "external_message_id" character varying,
                "created_at" timestamp NOT NULL DEFAULT now(),
                CONSTRAINT "PK_financeiro_whatsapp_messages" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_financeiro_whatsapp_messages_phone" ON "financeiro_whatsapp_messages" ("phone")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "financeiro_whatsapp_messages"`);
    }
}
