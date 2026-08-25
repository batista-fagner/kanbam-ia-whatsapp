import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSchedulingHandoffEnabled1786300000000 implements MigrationInterface {
    name = 'AddSchedulingHandoffEnabled1786300000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "whatsapp_config" ADD "scheduling_handoff_enabled" boolean NOT NULL DEFAULT false`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "whatsapp_config" DROP COLUMN "scheduling_handoff_enabled"`);
    }

}
