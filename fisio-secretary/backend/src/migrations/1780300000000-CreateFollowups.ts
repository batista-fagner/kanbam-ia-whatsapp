import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateFollowups1780300000000 implements MigrationInterface {
    name = 'CreateFollowups1780300000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "followups" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "tenant_id" uuid NOT NULL,
                "lead_id" uuid NOT NULL,
                "phone" character varying NOT NULL,
                "message" text NOT NULL,
                "scheduled_at" TIMESTAMP NOT NULL,
                "status" character varying NOT NULL DEFAULT 'pending',
                "source" character varying NOT NULL DEFAULT 'manual',
                "sent_at" TIMESTAMP,
                "error" text,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_followups" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`CREATE INDEX "IDX_followups_due" ON "followups" ("status", "scheduled_at")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_followups_due"`);
        await queryRunner.query(`DROP TABLE "followups"`);
    }
}
