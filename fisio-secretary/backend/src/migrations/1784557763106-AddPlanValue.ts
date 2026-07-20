import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPlanValue1784557763106 implements MigrationInterface {
    name = 'AddPlanValue1784557763106'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "whatsapp_config" ADD "plan_value" numeric(10,2)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "whatsapp_config" DROP COLUMN "plan_value"`);
    }
}
