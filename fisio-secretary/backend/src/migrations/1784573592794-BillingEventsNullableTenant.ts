import { MigrationInterface, QueryRunner } from "typeorm";

export class BillingEventsNullableTenant1784573592794 implements MigrationInterface {
    name = 'BillingEventsNullableTenant1784573592794'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "billing_events" ADD "label" character varying`);
        await queryRunner.query(`ALTER TABLE "billing_events" ALTER COLUMN "tenant_id" DROP NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "billing_events" ALTER COLUMN "tenant_id" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "billing_events" DROP COLUMN "label"`);
    }
}
