import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

// Agente de um tenant no sistema multi-agente (Supervisor + sub-agentes).
// O "Supervisor" não é uma linha aqui — é a lógica de roteamento que escolhe
// entre os agentes ativos (isActive) usando a `description` de cada um.
@Entity('agents')
@Index(['tenantId'])
export class Agent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  // O que o agente faz — o supervisor usa isso pra decidir o roteamento.
  @Column({ type: 'varchar', length: 500, default: '' })
  description: string;

  // Assuntos que esse agente cobre (texto livre, uma linha por assunto).
  @Column({ name: 'responds_to', type: 'text', default: '' })
  respondsTo: string;

  // Quando o agente deve passar o bastão (handoff) pro supervisor.
  @Column({ name: 'handoff_when', type: 'text', default: '' })
  handoffWhen: string;

  // Prompt/comportamento específico do agente.
  @Column({ name: 'system_prompt', type: 'text', default: '' })
  systemPrompt: string;

  // Conectado ao supervisor (aparece no canvas). false = fica na "palette".
  @Column({ name: 'is_active', type: 'boolean', default: false })
  isActive: boolean;

  // Agente de entrada: recebe a 1ª mensagem antes de qualquer roteamento.
  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean;

  // Capacidades do agente — controlam quais blocos do prompt são montados.
  // false = economiza tokens (não injeta as regras/tabela correspondentes).
  @Column({ name: 'can_schedule', type: 'boolean', default: true })
  canSchedule: boolean;

  @Column({ name: 'can_send_media', type: 'boolean', default: true })
  canSendMedia: boolean;

  @Column({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
