import { MigrationInterface, QueryRunner } from 'typeorm';

// Tabela de preços por TAMANHO (cm) — piloto Studio Simone Trindade, que vende
// cabelo por peça/comprimento e não por gramatura. Coluna nova com default '[]':
// as configs existentes (S&A, Heline, alex_teste) continuam idênticas.
export class AddPriceConfigSizeProducts1788200000000 implements MigrationInterface {
  name = 'AddPriceConfigSizeProducts1788200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "price_configs" ADD "size_products" jsonb NOT NULL DEFAULT '[]'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "price_configs" DROP COLUMN "size_products"`);
  }
}
