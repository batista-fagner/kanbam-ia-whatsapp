import { MigrationInterface, QueryRunner } from 'typeorm';

// Posição salva do nó do agente no canvas do Agent Builder (React Flow). Null =
// ainda não foi arrastado manualmente, usa o auto-layout calculado no frontend.
export class AddAgentCanvasPosition1784000000000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS canvas_x DOUBLE PRECISION`);
    await qr.query(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS canvas_y DOUBLE PRECISION`);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE agents DROP COLUMN IF EXISTS canvas_y`);
    await qr.query(`ALTER TABLE agents DROP COLUMN IF EXISTS canvas_x`);
  }
}
