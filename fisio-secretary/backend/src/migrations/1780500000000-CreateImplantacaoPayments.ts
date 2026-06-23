import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateImplantacaoPayments1780500000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS implantacao_payments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR NOT NULL,
        phone VARCHAR NOT NULL,
        status VARCHAR NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS implantacao_payments`);
  }
}
