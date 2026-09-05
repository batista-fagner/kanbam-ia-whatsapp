import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateOnboardingSettings1786800000000 implements MigrationInterface {
    name = 'CreateOnboardingSettings1786800000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "onboarding_settings" ("id" integer NOT NULL DEFAULT 1, "group_enabled" boolean NOT NULL DEFAULT true, "team_phones" jsonb NOT NULL DEFAULT '[]'::jsonb, "welcome_message" text NOT NULL DEFAULT '', "form_message_enabled" boolean NOT NULL DEFAULT true, "form_message" text NOT NULL DEFAULT '', "form_delay_minutes" integer NOT NULL DEFAULT 60, "form_url" text NOT NULL DEFAULT '', "form_entry_field" text NOT NULL DEFAULT '', "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_onboarding_settings_id" PRIMARY KEY ("id"))`);

        // Linha única já criada com os valores em uso hoje (números da equipe e o Google Form
        // que estava hardcoded no frontend), pra tela nascer preenchida.
        await queryRunner.query(`
            INSERT INTO "onboarding_settings" ("id", "group_enabled", "team_phones", "welcome_message", "form_message_enabled", "form_message", "form_delay_minutes", "form_url", "form_entry_field")
            VALUES (
                1,
                true,
                '["71992867765","71983239695","71991218461","71986257997"]'::jsonb,
                'Seja muito bem-vinda, {nome}! 🎉

Esse é o grupo do seu projeto com a nossa equipe. A partir de agora é por aqui que a gente organiza tudo junto com você.

Qualquer dúvida, é só chamar aqui mesmo. 🙏',
                true,
                'Oi {nome}! Pra gente configurar a sua IA do jeito certo, preenche esse formulário rapidinho com as informações da sua loja:

{link}

Assim que você enviar, a gente já começa a montar tudo. 🚀',
                60,
                'https://docs.google.com/forms/d/e/1FAIpQLSeY2IZLnw5Cw5FbRI2scRipQFT-qHrnUt3ujBfdoTWgUETiVw/viewform',
                'entry.995908210'
            )
            ON CONFLICT ("id") DO NOTHING
        `);

        await queryRunner.query(`ALTER TABLE "whatsapp_config" ADD "onboarding_group_jid" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "whatsapp_config" DROP COLUMN "onboarding_group_jid"`);
        await queryRunner.query(`DROP TABLE "onboarding_settings"`);
    }
}
