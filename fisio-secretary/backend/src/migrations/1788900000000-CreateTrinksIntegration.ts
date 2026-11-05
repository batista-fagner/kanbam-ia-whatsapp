import { MigrationInterface, QueryRunner } from 'typeorm';

// Integração com a Trinks (piloto DALU): a IA agenda direto na agenda da Trinks.
// - agenda_integrations: chave da API (criptografada), estabelecimento, catálogo copiado, cota do mês.
// - agenda_services: ligação de cada serviço do salão com o serviço da Trinks + aprovação da cliente.
// - appointments: cópia local do agendamento feito na Trinks (lembrete, card do lead, histórico).
export class CreateTrinksIntegration1788900000000 implements MigrationInterface {
  name = 'CreateTrinksIntegration1788900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS agenda_integrations (
        tenant_id uuid PRIMARY KEY,
        provider varchar NOT NULL DEFAULT 'trinks',
        api_key_enc text NOT NULL,
        establishment_id varchar NULL,
        establishment_name varchar NULL,
        auto_confirm boolean NOT NULL DEFAULT false,
        catalog jsonb NULL,
        catalog_synced_at timestamp NULL,
        usage_month varchar NULL,
        usage_count integer NOT NULL DEFAULT 0,
        last_error text NULL,
        last_error_at timestamp NULL,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      )`);

    await queryRunner.query(`ALTER TABLE agenda_services
      ADD COLUMN IF NOT EXISTS external_id varchar NULL,
      ADD COLUMN IF NOT EXISTS external_name varchar NULL,
      ADD COLUMN IF NOT EXISTS external_duration_minutes integer NULL,
      ADD COLUMN IF NOT EXISTS approved_at timestamp NULL,
      ADD COLUMN IF NOT EXISTS approved_by varchar NULL`);

    await queryRunner.query(`ALTER TABLE appointments
      ADD COLUMN IF NOT EXISTS external_provider varchar NULL,
      ADD COLUMN IF NOT EXISTS external_id varchar NULL,
      ADD COLUMN IF NOT EXISTS external_client_id varchar NULL,
      ADD COLUMN IF NOT EXISTS external_professional_id varchar NULL,
      ADD COLUMN IF NOT EXISTS external_professional_name varchar NULL`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_appointments_external ON appointments (external_provider, external_id) WHERE external_id IS NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_appointments_external`);
    await queryRunner.query(`ALTER TABLE appointments
      DROP COLUMN IF EXISTS external_provider,
      DROP COLUMN IF EXISTS external_id,
      DROP COLUMN IF EXISTS external_client_id,
      DROP COLUMN IF EXISTS external_professional_id,
      DROP COLUMN IF EXISTS external_professional_name`);
    await queryRunner.query(`ALTER TABLE agenda_services
      DROP COLUMN IF EXISTS external_id,
      DROP COLUMN IF EXISTS external_name,
      DROP COLUMN IF EXISTS external_duration_minutes,
      DROP COLUMN IF EXISTS approved_at,
      DROP COLUMN IF EXISTS approved_by`);
    await queryRunner.query(`DROP TABLE IF EXISTS agenda_integrations`);
  }
}
