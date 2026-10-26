import { MigrationInterface, QueryRunner } from 'typeorm';

// Follow-up por inatividade só vale para quem parar de responder DEPOIS que a raia foi
// ligada (`activeSince` dentro de cada regra do jsonb auto_followup_config). Sem isso,
// ligar a regra disparava para todo lead antigo parado na raia — no teste, 625 leads de
// meses atrás de uma vez só, risco real de bloqueio do número.
// Regras que já estavam ligadas recebem a hora do deploy: a partir de agora, ninguém antigo.
export class AddAutoFollowupActiveSince1788600000000 implements MigrationInterface {
  name = 'AddAutoFollowupActiveSince1788600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows: Array<{ id: string; cfg: Record<string, any> }> = await queryRunner.query(
      `SELECT id, auto_followup_config AS cfg FROM whatsapp_config WHERE auto_followup_config IS NOT NULL`,
    );
    const now = new Date().toISOString();
    for (const row of rows) {
      const cfg = row.cfg && typeof row.cfg === 'object' ? { ...row.cfg } : null;
      if (!cfg) continue;
      let changed = false;
      for (const [stage, rule] of Object.entries(cfg)) {
        if (rule && typeof rule === 'object' && (rule as any).enabled && !(rule as any).activeSince) {
          cfg[stage] = { ...(rule as any), activeSince: now };
          changed = true;
        }
      }
      if (changed) {
        await queryRunner.query(`UPDATE whatsapp_config SET auto_followup_config = $1::jsonb WHERE id = $2`, [JSON.stringify(cfg), row.id]);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const rows: Array<{ id: string; cfg: Record<string, any> }> = await queryRunner.query(
      `SELECT id, auto_followup_config AS cfg FROM whatsapp_config WHERE auto_followup_config IS NOT NULL`,
    );
    for (const row of rows) {
      const cfg = { ...row.cfg };
      for (const stage of Object.keys(cfg)) {
        if (cfg[stage] && typeof cfg[stage] === 'object') {
          const { activeSince, ...rest } = cfg[stage];
          cfg[stage] = rest;
        }
      }
      await queryRunner.query(`UPDATE whatsapp_config SET auto_followup_config = $1::jsonb WHERE id = $2`, [JSON.stringify(cfg), row.id]);
    }
  }
}
