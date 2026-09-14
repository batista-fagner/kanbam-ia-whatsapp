import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateGroupMonitorSettings1787400000000 implements MigrationInterface {
    name = 'CreateGroupMonitorSettings1787400000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "group_monitor_settings" ("id" integer NOT NULL DEFAULT 1, "risk_alert_phone" character varying, "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_group_monitor_settings_id" PRIMARY KEY ("id"))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "group_monitor_settings"`);
    }
}
