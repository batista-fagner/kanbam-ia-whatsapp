import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAutoFollowup1780700000000 implements MigrationInterface {
    name = 'AddAutoFollowup1780700000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Config de follow-up automático por raia (JSON: { novo_lead: {...}, lead_frio: {...}, lead_quente: {...} })
        await queryRunner.query(`ALTER TABLE "whatsapp_config" ADD "auto_followup_config" jsonb`);
        // Raias para as quais cada lead JÁ recebeu follow-up automático (garante 1x por raia, para sempre)
        await queryRunner.query(`ALTER TABLE "leads" ADD "auto_followup_sent_stages" jsonb NOT NULL DEFAULT '[]'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "leads" DROP COLUMN "auto_followup_sent_stages"`);
        await queryRunner.query(`ALTER TABLE "whatsapp_config" DROP COLUMN "auto_followup_config"`);
    }
}
