import { MigrationInterface, QueryRunner } from 'typeorm';

// Tempo que a IA espera antes de responder passa a ser configurável por cliente.
// Quem já tinha tempo próprio no código mantém o mesmo valor; o admin sobe para 35s.
export class AddReplyDelaySeconds1788800000000 implements MigrationInterface {
  name = 'AddReplyDelaySeconds1788800000000';

  private readonly seed: Record<string, number> = {
    '1ff3f0b3-52d1-4e89-b7bf-552d0556de29': 25,
    'e624e817-5b6c-4840-b0ea-269eb78afe8d': 5,
    '3ff8efe4-7a7c-44ee-b98b-548e5921b174': 45,
    '69420c85-634c-451d-af45-2ebccf8aa1d3': 30,
    'd69c3b3a-5b96-4c7d-9bce-ea7c44533d5c': 35,
    '2c562828-0fe9-43c8-bad0-77a931968afc': 35,
  };

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE whatsapp_config ADD COLUMN IF NOT EXISTS reply_delay_seconds integer NULL`);
    for (const [id, seconds] of Object.entries(this.seed)) {
      await queryRunner.query(`UPDATE whatsapp_config SET reply_delay_seconds = $1 WHERE id = $2`, [seconds, id]);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE whatsapp_config DROP COLUMN IF EXISTS reply_delay_seconds`);
  }
}
