import { MigrationInterface, QueryRunner } from "typeorm";

export class AddClientOriginAndImplantacaoAmount1786900000000 implements MigrationInterface {
    name = 'AddClientOriginAndImplantacaoAmount1786900000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Origem do cliente — alimentada pelo UTM do checkout ou pelo sync com o convertHairCRM.
        await queryRunner.query(`ALTER TABLE "whatsapp_config" ADD "origin_source" character varying`);
        await queryRunner.query(`ALTER TABLE "whatsapp_config" ADD "origin_medium" character varying`);
        await queryRunner.query(`ALTER TABLE "whatsapp_config" ADD "origin_campaign" character varying`);
        await queryRunner.query(`ALTER TABLE "whatsapp_config" ADD "origin_synced_at" TIMESTAMP`);

        // Implantação: valor cobrado + vínculo com o tenant, pra receita ser atribuível ao cliente.
        await queryRunner.query(`ALTER TABLE "implantacao_payments" ADD "amount" numeric(10,2)`);
        await queryRunner.query(`ALTER TABLE "implantacao_payments" ADD "tenant_id" uuid`);
        await queryRunner.query(`CREATE INDEX "IDX_implantacao_payments_tenant" ON "implantacao_payments" ("tenant_id")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_implantacao_payments_tenant"`);
        await queryRunner.query(`ALTER TABLE "implantacao_payments" DROP COLUMN "tenant_id"`);
        await queryRunner.query(`ALTER TABLE "implantacao_payments" DROP COLUMN "amount"`);
        await queryRunner.query(`ALTER TABLE "whatsapp_config" DROP COLUMN "origin_synced_at"`);
        await queryRunner.query(`ALTER TABLE "whatsapp_config" DROP COLUMN "origin_campaign"`);
        await queryRunner.query(`ALTER TABLE "whatsapp_config" DROP COLUMN "origin_medium"`);
        await queryRunner.query(`ALTER TABLE "whatsapp_config" DROP COLUMN "origin_source"`);
    }
}
