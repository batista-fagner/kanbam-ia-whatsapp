import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

// Rascunho de prompt gerado a partir do form de onboarding (agente de CS, Fase 1).
// Nunca vai ao ar sozinho — só quando alguém da equipe aprova (status='approved'),
// o que copia "content" para custom_prompt_sofia/custom_prompt_megahair do tenant.
@Entity('generated_prompts')
export class GeneratedPrompt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  // Tenant cujo prompt foi usado de modelo/referência pra gerar este rascunho.
  @Column({ name: 'reference_tenant_id', type: 'uuid', nullable: true })
  referenceTenantId: string | null;

  // FK solta pra onboarding_forms — qual resposta de formulário originou este rascunho.
  @Column({ name: 'source_form_id', type: 'uuid', nullable: true })
  sourceFormId: string | null;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'varchar', default: 'draft' })
  status: 'draft' | 'approved' | 'discarded';

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
