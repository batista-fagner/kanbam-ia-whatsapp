import { MigrationInterface, QueryRunner } from 'typeorm';

// Marca módulos que precisam da tabela de datas completa (calculada em
// código, ver buildDateBlock em ai.service.ts) — sem isso a IA não tem como
// converter "amanhã"/"sexta" num appointmentDateTime real, e o agendamento
// "confirmado" em texto nunca vira evento de verdade.
export class AddPromptModuleDateTable1784400000000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE prompt_modules ADD COLUMN IF NOT EXISTS injects_date_table BOOLEAN NOT NULL DEFAULT false`);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE prompt_modules DROP COLUMN IF EXISTS injects_date_table`);
  }
}
