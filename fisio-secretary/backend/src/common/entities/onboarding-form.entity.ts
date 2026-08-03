import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

// Respostas cruas do Google Form de onboarding (Fase 1 do agente de CS).
// Nunca perder o que o cliente escreveu, mesmo se não achar o tenant (email divergente).
@Entity('onboarding_forms')
export class OnboardingForm {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId: string | null;

  @Column({ type: 'varchar', nullable: true })
  email: string | null;

  // { "COMO VAI SE CHAMAR A IA": "...", "NOME DA EMPRESA": "...", ... } — chave = título da pergunta.
  @Column({ type: 'jsonb' })
  answers: Record<string, string>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
