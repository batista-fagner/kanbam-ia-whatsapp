import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateTrafficReports1789000000000 implements MigrationInterface {
    name = 'CreateTrafficReports1789000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "traffic_report_clients" (
            "id" uuid NOT NULL DEFAULT gen_random_uuid(),
            "name" character varying NOT NULL,
            "ad_account_id" character varying NOT NULL,
            "group_jid" character varying NOT NULL,
            "approver_phone" character varying NOT NULL,
            "require_approval" boolean NOT NULL DEFAULT true,
            "active" boolean NOT NULL DEFAULT true,
            "next_report_date" date NOT NULL,
            "created_at" TIMESTAMP NOT NULL DEFAULT now(),
            "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
            CONSTRAINT "PK_traffic_report_clients_id" PRIMARY KEY ("id"),
            CONSTRAINT "UQ_traffic_report_clients_ad_account" UNIQUE ("ad_account_id")
        )`);

        await queryRunner.query(`CREATE TABLE "traffic_reports" (
            "id" uuid NOT NULL DEFAULT gen_random_uuid(),
            "client_id" uuid NOT NULL,
            "period_start" date NOT NULL,
            "period_end" date NOT NULL,
            "status" character varying NOT NULL DEFAULT 'pending',
            "text" text NOT NULL DEFAULT '',
            "internal_note" text NOT NULL DEFAULT '',
            "metrics" jsonb,
            "approval_token" character varying NOT NULL,
            "error" text,
            "created_at" TIMESTAMP NOT NULL DEFAULT now(),
            "sent_at" TIMESTAMP,
            CONSTRAINT "PK_traffic_reports_id" PRIMARY KEY ("id"),
            CONSTRAINT "FK_traffic_reports_client" FOREIGN KEY ("client_id") REFERENCES "traffic_report_clients"("id") ON DELETE CASCADE
        )`);
        await queryRunner.query(`CREATE INDEX "IDX_traffic_reports_client_id" ON "traffic_reports" ("client_id")`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_traffic_reports_approval_token" ON "traffic_reports" ("approval_token")`);

        // Clientes de tráfego já em operação em 16/11/2026. O 1º relatório manual cobriu
        // 10 a 15/11; o próximo sai em 23/11 (segunda, 19h) cobrindo 16 a 22/11.
        await queryRunner.query(`INSERT INTO "traffic_report_clients" ("name", "ad_account_id", "group_jid", "approver_phone", "next_report_date") VALUES
            ('Glow Hair', '1649444122799278', '120363413068983774@g.us', '5571992867765', '2026-11-23'),
            ('Paraíso dos Fios', '5443313709227524', '120363411810828092@g.us', '5571992867765', '2026-11-23'),
            ('Adriele', '1539768727926688', '120363431622452908@g.us', '5571992867765', '2026-11-23')
            ON CONFLICT ("ad_account_id") DO NOTHING`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "traffic_reports"`);
        await queryRunner.query(`DROP TABLE "traffic_report_clients"`);
    }
}
