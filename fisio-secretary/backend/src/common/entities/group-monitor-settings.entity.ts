import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

// Config do monitoramento de grupos "Projeto X" (relatório diário + alerta de risco) —
// separada de OnboardingSettings de propósito: aquela tabela configura a CRIAÇÃO do grupo
// (welcomeMessage, teamPhones...), esta configura o MONITORAMENTO das conversas depois de
// criado. Mesmo padrão singleton (id=1) já usado no projeto (ver OnboardingSettings).
@Entity('group_monitor_settings')
export class GroupMonitorSettings {
  @PrimaryColumn({ type: 'int', default: 1 })
  id: number;

  // Número que recebe o alerta imediato de risco. Editável pelo admin na tela "Relatórios
  // de Grupos" — null = alerta desligado (loga e sai, não quebra o fluxo).
  @Column({ name: 'risk_alert_phone', type: 'varchar', nullable: true })
  riskAlertPhone: string | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
