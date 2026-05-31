import { MigrationInterface, QueryRunner } from "typeorm";

export class TenantConstraints1780170997907 implements MigrationInterface {
    name = 'TenantConstraints1780170997907'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "leads" ALTER COLUMN "tenant_id" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "leads" DROP CONSTRAINT "UQ_42ebb4366d014febbcfdef39e36"`);
        await queryRunner.query(`ALTER TABLE "campaigns" ALTER COLUMN "tenant_id" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "media_files" ALTER COLUMN "tenant_id" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "media_files" DROP CONSTRAINT "UQ_6b1fd78e98f0917d51656759a94"`);
        await queryRunner.query(`ALTER TABLE "deleted_leads" ALTER COLUMN "tenant_id" SET NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_leads_tenant_phone" ON "leads" ("tenant_id", "phone") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_media_files_tenant_name" ON "media_files" ("tenant_id", "name") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."UQ_media_files_tenant_name"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_leads_tenant_phone"`);
        await queryRunner.query(`ALTER TABLE "deleted_leads" ALTER COLUMN "tenant_id" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "media_files" ADD CONSTRAINT "UQ_6b1fd78e98f0917d51656759a94" UNIQUE ("name")`);
        await queryRunner.query(`ALTER TABLE "media_files" ALTER COLUMN "tenant_id" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "campaigns" ALTER COLUMN "tenant_id" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "leads" ADD CONSTRAINT "UQ_42ebb4366d014febbcfdef39e36" UNIQUE ("phone")`);
        await queryRunner.query(`ALTER TABLE "leads" ALTER COLUMN "tenant_id" DROP NOT NULL`);
    }

}
