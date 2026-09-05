import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

// Tabela de linha única (id fixo) — configuração global do onboarding pós-pagamento,
// editável na aba "Onboarding" do Admin em vez de hardcoded/env. Mesmo padrão de
// CheckoutSettings (checkout-settings.entity.ts).
@Entity('onboarding_settings')
export class OnboardingSettings {
  @PrimaryColumn({ type: 'int', default: 1 })
  id: number;

  // Liga/desliga a criação automática do grupo quando um pagamento é confirmado.
  @Column({ name: 'group_enabled', type: 'boolean', default: true })
  groupEnabled: boolean;

  // Números da equipe que entram no grupo junto com a cliente (só dígitos, com ou sem DDI —
  // normalizado na hora de enviar). Editável na tela porque o time muda e números podem
  // ficar restritos temporariamente.
  @Column({ name: 'team_phones', type: 'jsonb', default: () => `'[]'::jsonb` })
  teamPhones: string[];

  // Mensagem enviada no grupo assim que ele é criado. Aceita {nome}.
  @Column({ name: 'welcome_message', type: 'text', default: '' })
  welcomeMessage: string;

  // 2ª mensagem (link do formulário de onboarding), enviada X minutos depois.
  @Column({ name: 'form_message_enabled', type: 'boolean', default: true })
  formMessageEnabled: boolean;

  // Aceita {nome} e {link}.
  @Column({ name: 'form_message', type: 'text', default: '' })
  formMessage: string;

  @Column({ name: 'form_delay_minutes', type: 'integer', default: 60 })
  formDelayMinutes: number;

  // Google Form de onboarding + campo oculto que recebe o tenantId. Ficavam hardcoded no
  // frontend (AdminPage.jsx buildOnboardingLink) — aqui o backend monta o mesmo link e dá
  // pra trocar o formulário sem deploy.
  @Column({ name: 'form_url', type: 'text', default: '' })
  formUrl: string;

  @Column({ name: 'form_entry_field', type: 'text', default: '' })
  formEntryField: string;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
