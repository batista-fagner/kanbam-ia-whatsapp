import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export interface ClientFormFile {
  id: string;
  questionId: string;
  name: string;
  url: string;
  key: string;
  size: number;
  mimetype: string;
}

// Formulário próprio de onboarding (alternativa ao Google Forms). Um link por cliente+formulário,
// acessado por token aleatório (sem login). O rascunho é salvo a cada resposta; no envio final
// as respostas também viram uma linha em onboarding_forms, pra reaproveitar a tela de Onboarding
// e a geração de rascunho de prompt.
@Entity('client_forms')
export class ClientForm {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  // Chave da definição em forms/form-definitions.ts (ex.: 'festas')
  @Column({ name: 'form_key', type: 'varchar' })
  formKey: string;

  @Column({ type: 'varchar', unique: true })
  token: string;

  // { [questionId]: texto }
  @Column({ type: 'jsonb', default: () => `'{}'` })
  answers: Record<string, string>;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  files: ClientFormFile[];

  @Column({ name: 'submitted_at', type: 'timestamp', nullable: true })
  submittedAt: Date | null;

  // Linha criada em onboarding_forms no 1º envio — reenvios atualizam a mesma linha.
  @Column({ name: 'onboarding_form_id', type: 'uuid', nullable: true })
  onboardingFormId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
