import { MigrationInterface, QueryRunner } from "typeorm";

export class AddClientTestChurnAndExtraCharges1787000000000 implements MigrationInterface {
    name = 'AddClientTestChurnAndExtraCharges1787000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "whatsapp_config" ADD "is_test" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "whatsapp_config" ADD "churned_at" TIMESTAMP`);
        await queryRunner.query(`ALTER TABLE "whatsapp_config" ADD "churn_reason" character varying`);

        await queryRunner.query(`CREATE TABLE "client_extra_charges" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "tenant_id" uuid NOT NULL, "description" character varying NOT NULL, "amount" numeric(10,2) NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_client_extra_charges_id" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_client_extra_charges_tenant" ON "client_extra_charges" ("tenant_id")`);

        // Contas de teste do time / leads que nunca pagaram — somem da tela Financeiro.
        await queryRunner.query(`
            UPDATE "whatsapp_config" SET "is_test" = true
            WHERE "id" IN (
                '6d55c3bc-beb0-4640-ac23-70b2c5af171f', -- Wesley
                '1ff3f0b3-52d1-4e89-b7bf-552d0556de29', -- claudia_teste_multiagente
                '31e686ee-1008-45f5-be85-86e6273759d6', -- Claudia Studio Hair
                'e624e817-5b6c-4840-b0ea-269eb78afe8d', -- alex_teste
                '401a3efb-9a0a-47f4-bed4-233baefe607d', -- Is_cabelosnaturais
                '6fac64ce-9189-414a-9ad9-fd2fc102e599'  -- Tiago Adan (conta do operador)
            )
        `);

        // Clientes que pagaram ao menos 1 vez e deram churn — saem do MRR, mas continuam
        // visíveis na categoria "Churn" com a receita histórica preservada.
        await queryRunner.query(`
            UPDATE "whatsapp_config" SET "churned_at" = now(), "churn_reason" = 'Não renovou'
            WHERE "id" = '3c2cbbb2-1f57-4f9a-acc3-5dfbb949c44f' -- Scarlett caroline beauty
        `);
        await queryRunner.query(`
            UPDATE "whatsapp_config" SET "churned_at" = now(), "churn_reason" = 'Pagou mas nunca chegou a usar'
            WHERE "id" = '668650de-d0c3-4316-b073-c24f119968a5' -- Bel
        `);
        await queryRunner.query(`
            UPDATE "whatsapp_config" SET "churned_at" = now(), "churn_reason" = 'Pagou 1 vez mas não chegou a usar'
            WHERE "id" = '95907de0-c40e-4a3c-a8a6-051c35c902f1' -- Mayara Barbosa / Oriah cabelos naturais
        `);

        // Upgrade confirmado da Pamylys: além da assinatura, fechou o plano de tráfego pago.
        await queryRunner.query(`
            INSERT INTO "client_extra_charges" ("id", "tenant_id", "description", "amount", "created_at")
            VALUES (gen_random_uuid(), '1597574a-6ca8-4b52-9b05-79e3ddb2f30b', 'Plano tráfego pago', 1500.00, now())
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_client_extra_charges_tenant"`);
        await queryRunner.query(`DROP TABLE "client_extra_charges"`);
        await queryRunner.query(`ALTER TABLE "whatsapp_config" DROP COLUMN "churn_reason"`);
        await queryRunner.query(`ALTER TABLE "whatsapp_config" DROP COLUMN "churned_at"`);
        await queryRunner.query(`ALTER TABLE "whatsapp_config" DROP COLUMN "is_test"`);
    }
}
