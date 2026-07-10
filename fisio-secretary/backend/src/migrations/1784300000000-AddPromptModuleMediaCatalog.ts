import { MigrationInterface, QueryRunner } from 'typeorm';

// Marca módulos que devem receber o catálogo de mídia do tenant injetado
// dinamicamente (ver PromptModulesService) — corrige o módulo Catálogo &
// Vídeos ter uma lista de mediaName fixa no texto, que ficava desatualizada
// assim que o cliente cadastrava vídeo novo.
export class AddPromptModuleMediaCatalog1784300000000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE prompt_modules ADD COLUMN IF NOT EXISTS injects_media_catalog BOOLEAN NOT NULL DEFAULT false`);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE prompt_modules DROP COLUMN IF EXISTS injects_media_catalog`);
  }
}
