import { Controller, Get, Put, Post, Body, Param, Query, UseGuards, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { WhatsappConfig } from '../common/entities/whatsapp-config.entity';
import { GroupMessage } from '../common/entities/group-message.entity';
import { GroupDailyReport } from '../common/entities/group-daily-report.entity';
import { GroupMonitorService } from './group-monitor.service';
import { GroupMonitorReportService } from './group-monitor-report.service';

// Endpoints do Admin pra tela "Relatórios de Grupos" — não confundir com
// /admin/onboarding (OnboardingController), que é outra feature (form → rascunho de prompt).
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/group-monitor')
export class GroupMonitorController {
  constructor(
    @InjectRepository(WhatsappConfig) private readonly configRepo: Repository<WhatsappConfig>,
    @InjectRepository(GroupMessage) private readonly messageRepo: Repository<GroupMessage>,
    @InjectRepository(GroupDailyReport) private readonly reportRepo: Repository<GroupDailyReport>,
    private readonly monitor: GroupMonitorService,
    private readonly reportService: GroupMonitorReportService,
  ) {}

  @Get('overview')
  async overview(@Query('date') date?: string) {
    const reportDate = date ?? this._todayBrt();
    const reports = await this.reportRepo.find({ where: { reportDate } });
    return {
      date: reportDate,
      totalReports: reports.length,
      riskCount: reports.filter((r) => r.sentiment === 'risco').length,
      opportunityCount: reports.filter((r) => r.opportunitySignal).length,
      sentimentBreakdown: {
        positivo: reports.filter((r) => r.sentiment === 'positivo').length,
        neutro: reports.filter((r) => r.sentiment === 'neutro').length,
        risco: reports.filter((r) => r.sentiment === 'risco').length,
      },
    };
  }

  @Get('reports')
  async list(@Query('date') date?: string) {
    const reportDate = date ?? this._todayBrt();
    const reports = await this.reportRepo.find({ where: { reportDate }, order: { sentiment: 'ASC' } });
    if (reports.length === 0) return [];

    const tenantIds = [...new Set(reports.map((r) => r.tenantId))];
    const tenants = await this.configRepo.findByIds(tenantIds);
    const tenantById = new Map(tenants.map((t) => [t.id, t]));

    return reports.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      clientName: tenantById.get(r.tenantId)?.displayName ?? r.tenantId,
      reportDate: r.reportDate,
      messageCount: r.messageCount,
      summary: r.summary,
      sentiment: r.sentiment,
      doubtCategories: r.doubtCategories,
      opportunitySignal: r.opportunitySignal,
      opportunityNote: r.opportunityNote,
    }));
  }

  @Get('reports/:id')
  async detail(@Param('id') id: string) {
    const report = await this.reportRepo.findOne({ where: { id } });
    if (!report) throw new NotFoundException('Relatório não encontrado');

    const tenant = await this.configRepo.findOne({ where: { id: report.tenantId } });
    const { start, end } = this._dayRangeUtc(report.reportDate);
    const transcript = await this.messageRepo.find({
      where: { groupJid: report.groupJid, createdAt: Between(start, end) },
      order: { createdAt: 'ASC' },
    });

    return {
      ...report,
      clientName: tenant?.displayName ?? report.tenantId,
      transcript: transcript.map((m) => ({
        senderRole: m.senderRole,
        senderName: m.senderName,
        messageType: m.messageType,
        content: m.content,
        riskFlagged: m.riskFlagged,
        createdAt: m.createdAt,
      })),
    };
  }

  @Get('settings')
  async getSettings() {
    return this.monitor.getSettings();
  }

  @Put('settings')
  async updateSettings(@Body() body: { riskAlertPhone?: string | null }) {
    return this.monitor.updateSettings(body);
  }

  // Dev-only: roda o relatório diário sob demanda, sem esperar o cron das 18h.
  @Post('reports/run-now')
  async runNow(@Body() body: { date?: string }) {
    const reportDate = body.date ?? this._todayBrt();
    return this.reportService.runFor(reportDate);
  }

  private _todayBrt(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  }

  private _dayRangeUtc(reportDate: string): { start: Date; end: Date } {
    const start = new Date(`${reportDate}T00:00:00-03:00`);
    const end = new Date(`${reportDate}T23:59:59.999-03:00`);
    return { start, end };
  }
}
