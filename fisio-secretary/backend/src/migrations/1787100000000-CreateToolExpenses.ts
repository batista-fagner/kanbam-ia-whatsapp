import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateToolExpenses1787100000000 implements MigrationInterface {
  name = 'CreateToolExpenses1787100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "tool_expenses" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" varchar NOT NULL,
        "monthly_cost" numeric(10,2) NOT NULL,
        "billing_day" int,
        "created_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tool_expenses" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "tool_expenses"`);
  }
}
