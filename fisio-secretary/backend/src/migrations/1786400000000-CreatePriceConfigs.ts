import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePriceConfigs1786400000000 implements MigrationInterface {
    name = 'CreatePriceConfigs1786400000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "price_configs" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "tenant_id" uuid NOT NULL,
                "is_active" boolean NOT NULL DEFAULT false,
                "products" jsonb NOT NULL DEFAULT '[]',
                "tela_per_gram" numeric(10,2),
                "cartao_surcharge_per_100g" numeric(10,2),
                "especie_discount_per_100g" numeric(10,2),
                "min_gram" integer NOT NULL DEFAULT 50,
                "gram_step" integer NOT NULL DEFAULT 50,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_price_configs" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_price_configs_tenant" ON "price_configs" ("tenant_id")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "price_configs"`);
    }
}
