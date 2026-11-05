import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export interface TrinksCatalogService {
  id: number;
  nome: string;
  duracaoEmMinutos: number;
  preco: number | null;
}

export interface TrinksCatalogProfessional {
  id: number;
  nome: string;
  apelido: string | null;
  serviceIds: number[] | null; // null = não foi possível ler os serviços desse profissional
}

export interface TrinksCatalog {
  services: TrinksCatalogService[];
  professionals: TrinksCatalogProfessional[];
}

// Integração da agenda com um sistema externo (hoje só Trinks). 1 linha por cliente.
// A chave da API fica criptografada (common/utils/secret-box) e nunca volta para o navegador.
@Entity('agenda_integrations')
export class AgendaIntegration {
  @PrimaryColumn({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'varchar', default: 'trinks' })
  provider: 'trinks';

  @Column({ name: 'api_key_enc', type: 'text', select: false })
  apiKeyEnc: string;

  @Column({ name: 'establishment_id', type: 'varchar', nullable: true })
  establishmentId: string | null;

  @Column({ name: 'establishment_name', type: 'varchar', nullable: true })
  establishmentName: string | null;

  // false = o agendamento da IA entra "não confirmado" na Trinks e a recepção confirma lá.
  @Column({ name: 'auto_confirm', type: 'boolean', default: false })
  autoConfirm: boolean;

  @Column({ type: 'jsonb', nullable: true })
  catalog: TrinksCatalog | null;

  @Column({ name: 'catalog_synced_at', type: 'timestamp', nullable: true })
  catalogSyncedAt: Date | null;

  // Cota da Trinks: 5.000 chamadas por mês (UTC). usage_month = 'YYYY-MM'.
  @Column({ name: 'usage_month', type: 'varchar', nullable: true })
  usageMonth: string | null;

  @Column({ name: 'usage_count', type: 'integer', default: 0 })
  usageCount: number;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @Column({ name: 'last_error_at', type: 'timestamp', nullable: true })
  lastErrorAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
