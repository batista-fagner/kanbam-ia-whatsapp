import { MigrationInterface, QueryRunner } from 'typeorm';

// "Não lida" da Inbox: quando a conversa foi aberta pela última vez (por qualquer atendente
// da conta). Conversas que já existem nascem lidas — senão a Inbox estrearia com milhares
// de bolinhas de não lida.
export class AddConversationLastReadAt1788500000000 implements MigrationInterface {
  name = 'AddConversationLastReadAt1788500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "last_read_at" TIMESTAMP NULL`);
    await queryRunner.query(`UPDATE "conversations" SET "last_read_at" = NOW() WHERE "last_read_at" IS NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN IF EXISTS "last_read_at"`);
  }
}
