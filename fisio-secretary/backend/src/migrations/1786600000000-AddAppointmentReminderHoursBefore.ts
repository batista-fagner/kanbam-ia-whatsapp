import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Antecedência configurável do lembrete de agendamento.
 *
 * Não altera schema — `appointment_reminder` já é jsonb. Só faz backfill de
 * `hoursBefore: 24` em quem já tinha lembrete configurado, para que os tenants
 * existentes continuem recebendo exatamente na mesma antecedência de antes.
 * Linhas sem o campo também funcionam (o código cai em 24), mas o backfill deixa
 * a UI mostrar o valor correto no primeiro carregamento em vez de um select vazio.
 */
export class AddAppointmentReminderHoursBefore1786600000000 implements MigrationInterface {
    name = 'AddAppointmentReminderHoursBefore1786600000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            UPDATE "whatsapp_config"
               SET "appointment_reminder" = "appointment_reminder" || '{"hoursBefore": 24}'::jsonb
             WHERE "appointment_reminder" IS NOT NULL
               AND jsonb_typeof("appointment_reminder") = 'object'
               AND NOT jsonb_exists("appointment_reminder", 'hoursBefore')
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            UPDATE "whatsapp_config"
               SET "appointment_reminder" = "appointment_reminder" - 'hoursBefore'
             WHERE "appointment_reminder" IS NOT NULL
               AND jsonb_typeof("appointment_reminder") = 'object'
        `);
    }
}
