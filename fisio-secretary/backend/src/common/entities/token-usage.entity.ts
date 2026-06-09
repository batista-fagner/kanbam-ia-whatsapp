import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

@Entity('token_usage')
@Index('UQ_token_usage_tenant_date', ['tenantId', 'date'], { unique: true })
export class TokenUsage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'date' })
  date: string; // 'YYYY-MM-DD'

  @Column({ name: 'input_tokens', type: 'int', default: 0 })
  inputTokens: number;

  @Column({ name: 'cached_tokens', type: 'int', default: 0 })
  cachedTokens: number;

  @Column({ name: 'output_tokens', type: 'int', default: 0 })
  outputTokens: number;

  @Column({ name: 'cost_usd', type: 'numeric', precision: 10, scale: 8, default: 0 })
  costUsd: number;
}
