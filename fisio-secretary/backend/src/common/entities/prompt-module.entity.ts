import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

// Arquitetura "agente único + módulos dinâmicos" — protótipo em teste (2026-07),
// tenant único por enquanto. Substitui o handoff entre N agentes por um bloco
// fixo (isCore=true, sempre presente) + módulos de conhecimento carregados por
// palavra-chave conforme o assunto da mensagem (ver DynamicPromptService).
@Entity('prompt_modules')
@Index(['tenantId'])
export class PromptModule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  // true = bloco fixo (identidade/tom/guardrails), sempre incluído no prompt,
  // nunca selecionado por palavra-chave. Só deve existir 1 por tenant.
  @Column({ name: 'is_core', type: 'boolean', default: false })
  isCore: boolean;

  // Palavras-chave/regex (uma por linha) que ativam este módulo pro turno atual.
  // Vazio quando isCore=true (não se aplica).
  @Column({ type: 'text', default: '' })
  keywords: string;

  // Conteúdo do módulo (mesmo texto de negócio que hoje vive no system_prompt
  // de um agente — preço, catálogo, institucional, agendamento etc).
  @Column({ type: 'text', default: '' })
  content: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
