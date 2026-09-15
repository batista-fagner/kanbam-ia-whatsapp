import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, IsNull, Not, Repository } from 'typeorm';
import { WhatsappConfig } from '../common/entities/whatsapp-config.entity';
import { GroupMessage } from '../common/entities/group-message.entity';
import { GroupDailyReport } from '../common/entities/group-daily-report.entity';
import { AiService } from '../ai/ai.service';
import { GroupMonitorService } from './group-monitor.service';
import { GroupMonitorPdfService } from './group-monitor-pdf.service';

const TZ = 'America/Sao_Paulo';

// Gera 1 relatório por grupo "Projeto <cliente>" por dia, resumindo o que aconteceu
// (mesmo padrão de cron simples do BillingReminderService — produção roda
// QUEUE_ENGINE=legacy-cron, sem fila envolvida aqui).
@Injectable()
export class GroupMonitorReportService {
  private readonly logger = new Logger(GroupMonitorReportService.name);

  constructor(
    @InjectRepository(WhatsappConfig) private readonly configRepo: Repository<WhatsappConfig>,
    @InjectRepository(GroupMessage) private readonly messageRepo: Repository<GroupMessage>,
    @InjectRepository(GroupDailyReport) private readonly reportRepo: Repository<GroupDailyReport>,
    private readonly aiService: AiService,
    private readonly monitorService: GroupMonitorService,
    private readonly pdfService: GroupMonitorPdfService,
  ) {}

  @Cron('0 18 * * *', { timeZone: TZ })
  async generateDailyReports(): Promise<void> {
    await this.runFor(this._todayBrt());
  }

  // Separado do cron pra poder rodar manualmente em teste (script standalone) passando
  // uma data específica, sem esperar 18h.
  async runFor(reportDate: string): Promise<{ generated: number; skipped: number }> {
    const tenants = await this.configRepo.find({ where: { onboardingGroupJid: Not(IsNull()) } });
    const { start, end } = this._dayRangeUtc(reportDate);

    let generated = 0;
    let skipped = 0;

    for (const tenant of tenants) {
      if (!tenant.onboardingGroupJid) continue;

      const messages = await this.messageRepo.find({
        where: { groupJid: tenant.onboardingGroupJid, createdAt: Between(start, end) },
        order: { createdAt: 'ASC' },
      });

      if (messages.length === 0) {
        skipped++;
        continue; // sem atividade no dia — não gera linha vazia (ver plano, decisão de escopo)
      }

      const transcript = messages.map((m) =>
        `[${m.senderRole === 'client' ? 'Cliente' : m.senderRole === 'team' ? 'Equipe' : '?'}] ${m.content}`);

      const ai = await this.aiService.generateGroupDailyReport(tenant.displayName ?? 'Cliente', transcript);

      const existing = await this.reportRepo.findOne({ where: { tenantId: tenant.id, reportDate } });
      const row = existing ?? this.reportRepo.create({ tenantId: tenant.id, groupJid: tenant.onboardingGroupJid, reportDate });
      row.messageCount = messages.length;
      row.summary = ai.summary;
      row.sentiment = ai.sentiment;
      row.doubtCategories = ai.doubtCategories;
      row.opportunitySignal = ai.opportunitySignal;
      row.opportunityNote = ai.opportunityNote || null;
      row.rawJson = ai;
      row.awaitingClientResponse = this._isAwaitingClientResponse(messages);
      await this.reportRepo.save(row);
      generated++;
    }

    this.logger.log(`[GROUP-MONITOR][report] ${reportDate}: ${generated} relatório(s) gerado(s), ${skipped} grupo(s) sem atividade`);

    if (generated > 0) {
      await this._sendConsolidatedPdf(reportDate);
    }

    return { generated, skipped };
  }

  // PDF único com todos os relatórios do dia, enviado pro grupo configurado em
  // group_monitor_settings.pdfReportGroupJid (mesmo horário do relatório, sem fila —
  // ver runFor). Nunca lança: falha de PDF/envio só loga, não derruba o cron/endpoint.
  private async _sendConsolidatedPdf(reportDate: string): Promise<void> {
    try {
      const settings = await this.monitorService.getSettings();
      if (!settings.pdfReportGroupJid) return;

      const reports = await this.reportRepo.find({ where: { reportDate } });
      if (reports.length === 0) return;

      const tenantIds = [...new Set(reports.map((r) => r.tenantId))];
      const tenants = await this.configRepo.findByIds(tenantIds);
      const tenantById = new Map(tenants.map((t) => [t.id, t]));

      const rows = reports.map((r) => ({
        clientName: tenantById.get(r.tenantId)?.displayName ?? r.tenantId,
        sentiment: r.sentiment,
        messageCount: r.messageCount,
        summary: r.summary,
        doubtCategories: r.doubtCategories ?? [],
        opportunitySignal: r.opportunitySignal,
        opportunityNote: r.opportunityNote,
        awaitingClientResponse: r.awaitingClientResponse,
      }));

      const pdfBuffer = await this.pdfService.buildDailyReportPdf(reportDate, rows);
      const fileName = `relatorio-grupos-${reportDate}.pdf`;
      const sent = await this.monitorService.sendDocument(settings.pdfReportGroupJid, pdfBuffer, fileName);
      if (sent) {
        this.logger.log(`[GROUP-MONITOR][report] PDF de ${reportDate} enviado pro grupo configurado (${rows.length} cliente(s))`);
      }
    } catch (err: any) {
      this.logger.error(`[GROUP-MONITOR][report] Falha ao gerar/enviar PDF consolidado de ${reportDate}: ${err.message}`);
    }
  }

  // Sinal de churn silencioso: a equipe falou algo no grupo no dia e o cliente não
  // respondeu depois disso até o fechamento do relatório (18h). Calculado por horário
  // (não pela IA) — pega a última mensagem da equipe e verifica se existe alguma
  // mensagem do cliente depois dela no mesmo dia.
  private _isAwaitingClientResponse(messages: GroupMessage[]): boolean {
    let lastTeamAt: Date | null = null;
    for (const m of messages) {
      if (m.senderRole === 'team') lastTeamAt = m.createdAt;
    }
    if (!lastTeamAt) return false;

    return !messages.some((m) => m.senderRole === 'client' && m.createdAt > lastTeamAt!);
  }

  private _todayBrt(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
  }

  // Converte "YYYY-MM-DD" (dia civil em America/Sao_Paulo) pro intervalo UTC equivalente,
  // pra filtrar created_at (armazenado em UTC) corretamente independente do fuso do servidor.
  private _dayRangeUtc(reportDate: string): { start: Date; end: Date } {
    const start = new Date(`${reportDate}T00:00:00-03:00`);
    const end = new Date(`${reportDate}T23:59:59.999-03:00`);
    return { start, end };
  }
}
