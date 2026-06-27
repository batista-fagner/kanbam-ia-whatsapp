import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAppointmentReminder1780800000000 implements MigrationInterface {
    name = 'AddAppointmentReminder1780800000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "appointments" ADD "reminder_sent_at" TIMESTAMP`);
        await queryRunner.query(`ALTER TABLE "whatsapp_config" ADD "appointment_reminder" jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "whatsapp_config" DROP COLUMN "appointment_reminder"`);
        await queryRunner.query(`ALTER TABLE "appointments" DROP COLUMN "reminder_sent_at"`);
    }
}
