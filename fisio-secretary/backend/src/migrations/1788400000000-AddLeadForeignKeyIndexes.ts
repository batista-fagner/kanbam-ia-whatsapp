import { MigrationInterface, QueryRunner } from 'typeorm';

// Colunas de FK sem índice: apagar uma conversa fazia o Postgres varrer as ~365 mil mensagens
// para checar a FK (excluir 1.357 clientes importados levou 3 min). Também acelera abrir a
// conversa do lead e o dashboard (lead_stage_history por lead).
export class AddLeadForeignKeyIndexes1788400000000 implements MigrationInterface {
  name = 'AddLeadForeignKeyIndexes1788400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_messages_conversation_id" ON "messages" ("conversation_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_lead_stage_history_lead_id" ON "lead_stage_history" ("lead_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_appointments_lead_id" ON "appointments" ("lead_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_followups_lead_id" ON "followups" ("lead_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_followups_lead_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_appointments_lead_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_lead_stage_history_lead_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_messages_conversation_id"`);
  }
}
