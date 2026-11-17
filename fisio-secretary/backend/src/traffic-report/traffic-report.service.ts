import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { randomBytes } from 'crypto';
import { TrafficReportClient } from '../common/entities/traffic-report-client.entity';
import { TrafficReport } from '../common/entities/traffic-report.entity';
import { MetaAdsClient } from './meta-ads.client';
import {
  buildClientText, buildInternalNote, fmtDay, nextReportDate, parseInsightsRow, parseTopAd,
  previousPeriod, reportPeriod,
} from './traffic-report.format';

const TZ = 'America/Sao_Paulo';
// Link de aprovação vale 6 dias: no 7º já existe o relatório da semana seguinte.
const APPROVAL_TTL_MS = 6 * 24 * 60 * 60 * 1000;

// Relatório semanal de tráfego pago: todo dia às 19h (Brasília) gera o relatório dos
// clientes cujo dia chegou (de 7 em 7 dias, por cliente), manda o rascunho para o
// aprovador no WhatsApp com um link, e só envia ao grupo do cliente depois do "Aprovar".
//
// Cron simples (mesmo padrão do BillingReminderService): produção roda sem Redis.
@Injectable()
export class TrafficReportService {
  private readonly logger = new Logger(TrafficReportService.name);

  constructor(
    @InjectRepository(TrafficReportClient) private readonly clientRepo: Repository<TrafficReportClient>,
    @InjectRepository(TrafficReport) private readonly reportRepo: Repository<TrafficReport>,
    private readonly meta: MetaAdsClient,
    private readonly config: ConfigService,
    private readonly http: HttpService,
  ) {}

  @Cron('0 19 * * *', { timeZone: TZ })
  async runDaily(): Promise<void> {
    // Sem token da Meta a rotina fica desligada. É também o que impede um backend rodando
    // no computador de dev (banco copiado de produção) de mandar relatório de verdade.
    if (!this.meta.isConfigured()) {
      this.logger.warn('[TRAFFIC-REPORT] META_ADS_TOKEN não configurado — rotina ignorada');
      return;
    }
    const today = this.todayBrt();
    const due = await this.clientRepo
      .createQueryBuilder('c')
      .where('c.active = true AND c.next_report_date <= :today', { today })
      .getMany();
    for (const client of due) {
      try {
        await this.runForClient(client, today);
      } catch (err: any) {
        this.logger.error(`[TRAFFIC-REPORT] Erro inesperado em ${client.name}: ${err.message}`);
      }
    }
  }

  // Gera o relatório de um cliente no dia `runDate`. Só segue se conseguir avançar a data
  // do próximo envio de forma atômica: se o cron disparar duas vezes (redeploy às 19h, duas
  // instâncias), só uma passa daqui e o cliente não recebe relatório duplicado.
  async runForClient(client: TrafficReportClient, runDate: string): Promise<TrafficReport | null> {
    const next = nextReportDate(client.nextReportDate, runDate);
    const claim = await this.clientRepo
      .createQueryBuilder()
      .update(TrafficReportClient)
      .set({ nextReportDate: next })
      .where('id = :id AND next_report_date = :current', { id: client.id, current: client.nextReportDate })
      .execute();
    if (!claim.affected) return null;

    return this.generate(client, runDate);
  }

  // Busca os números na Meta, monta o texto e encaminha (aprovador ou grupo). Separado do
  // runForClient para o "gerar agora" do Admin não mexer na data do próximo envio.
  async generate(client: TrafficReportClient, runDate: string): Promise<TrafficReport> {
    const period = reportPeriod(runDate);
    const label = `${client.name} (${fmtDay(period.since)} a ${fmtDay(period.until)})`;
    const report = this.reportRepo.create({
      clientId: client.id,
      periodStart: period.since,
      periodEnd: period.until,
      approvalToken: randomBytes(24).toString('hex'),
      status: 'pending',
    });

    try {
      const prevPeriod = previousPeriod(period);
      const [curRow, prevRow, adRows] = await Promise.all([
        this.meta.accountTotals(client.adAccountId, period),
        this.meta.accountTotals(client.adAccountId, prevPeriod),
        this.meta.adBreakdown(client.adAccountId, period),
      ]);
      const cur = parseInsightsRow(curRow);
      const prev = prevRow ? parseInsightsRow(prevRow) : null;
      const topAd = parseTopAd(adRows);
      report.metrics = { current: cur, previous: prev, topAd };

      if (cur.spend <= 0) {
        // Conta parada na semana: mandar "R$ 0,00" no grupo do cliente só gera ruído.
        report.status = 'skipped';
        await this.reportRepo.save(report);
        await this.sendText(client.approverPhone, `📊 *Relatório de tráfego — ${label}*\n\nSem investimento no período. Nada foi enviado ao grupo.`);
        return report;
      }

      report.text = buildClientText(client.name, period, cur, prev);
      report.internalNote = buildInternalNote(cur, prev, topAd);
    } catch (err: any) {
      report.status = 'failed';
      report.error = String(err.message ?? err).slice(0, 1000);
      await this.reportRepo.save(report);
      this.logger.error(`[TRAFFIC-REPORT] Falha ao gerar ${label}: ${report.error}`);
      await this.sendText(client.approverPhone, `⚠️ *Relatório de tráfego não gerado — ${label}*\n\n${report.error}\n\nNada foi enviado ao grupo.`);
      return report;
    }

    await this.reportRepo.save(report);

    if (!client.requireApproval) {
      await this.deliver(report, client);
      return report;
    }

    const link = `${this.serverUrl()}/traffic-reports/approve/${report.approvalToken}`;
    const sent = await this.sendText(
      client.approverPhone,
      `📊 *Relatório para aprovar — ${label}*\n\n` +
        `*Texto que vai para o grupo:*\n\n${report.text}\n\n` +
        `———\n*Só para você:*\n${report.internalNote}\n\n` +
        `Aprovar, editar ou descartar:\n${link}`,
    );
    if (!sent) this.logger.error(`[TRAFFIC-REPORT] Rascunho de ${label} gerado, mas o aviso ao aprovador falhou`);
    else this.logger.log(`[TRAFFIC-REPORT] Rascunho de ${label} enviado ao aprovador`);
    return report;
  }

  // ───────────────────────── Aprovação (página pública por token) ─────────────────────────

  async findByToken(token: string): Promise<{ report: TrafficReport; client: TrafficReportClient | null; expired: boolean } | null> {
    if (!/^[a-f0-9]{48}$/.test(token ?? '')) return null;
    const report = await this.reportRepo.findOne({ where: { approvalToken: token } });
    if (!report) return null;
    const client = await this.clientRepo.findOne({ where: { id: report.clientId } });
    const expired = Date.now() - new Date(report.createdAt).getTime() > APPROVAL_TTL_MS;
    return { report, client, expired };
  }

  // Aprova e envia ao grupo. `text` é o texto final (o aprovador pode ter editado).
  async approve(token: string, text: string): Promise<{ ok: boolean; message: string }> {
    const found = await this.findByToken(token);
    if (!found || !found.client) return { ok: false, message: 'Relatório não encontrado.' };
    if (found.expired) return { ok: false, message: 'Este link expirou. O relatório da semana seguinte já deve ter sido gerado.' };
    const finalText = (text ?? '').trim();
    if (!finalText) return { ok: false, message: 'O texto está vazio.' };

    // pending → sending de forma atômica: clique duplo ou link aberto em dois aparelhos
    // não manda o relatório duas vezes para o grupo.
    const lock = await this.reportRepo
      .createQueryBuilder()
      .update(TrafficReport)
      .set({ status: 'sending', text: finalText })
      .where('id = :id AND status = :status', { id: found.report.id, status: 'pending' })
      .execute();
    if (!lock.affected) return { ok: false, message: this.statusMessage(found.report.status) };

    found.report.text = finalText;
    const delivered = await this.deliver(found.report, found.client);
    return delivered
      ? { ok: true, message: `Enviado ao grupo de ${found.client.name}.` }
      : { ok: false, message: 'Não foi possível enviar ao grupo agora. O relatório continua pendente: tente de novo em alguns minutos.' };
  }

  async discard(token: string): Promise<{ ok: boolean; message: string }> {
    const found = await this.findByToken(token);
    if (!found) return { ok: false, message: 'Relatório não encontrado.' };
    const res = await this.reportRepo
      .createQueryBuilder()
      .update(TrafficReport)
      .set({ status: 'discarded' })
      .where('id = :id AND status = :status', { id: found.report.id, status: 'pending' })
      .execute();
    return res.affected
      ? { ok: true, message: 'Relatório descartado. Nada foi enviado ao grupo.' }
      : { ok: false, message: this.statusMessage(found.report.status) };
  }

  statusMessage(status: TrafficReport['status']): string {
    switch (status) {
      case 'sent': return 'Este relatório já foi enviado ao grupo.';
      case 'sending': return 'Este relatório já está sendo enviado.';
      case 'discarded': return 'Este relatório foi descartado.';
      case 'skipped': return 'Não houve investimento no período; nada foi enviado.';
      case 'failed': return 'Este relatório não pôde ser gerado.';
      default: return 'Relatório aguardando aprovação.';
    }
  }

  // Envia ao grupo e fecha o status. Falha de envio devolve o relatório para "pendente",
  // para o aprovador poder tentar de novo pelo mesmo link.
  private async deliver(report: TrafficReport, client: TrafficReportClient): Promise<boolean> {
    const sent = await this.sendText(client.groupJid, report.text);
    if (sent) {
      await this.reportRepo.update(report.id, { status: 'sent', sentAt: new Date(), error: null });
      this.logger.log(`[TRAFFIC-REPORT] Relatório de ${client.name} enviado ao grupo`);
    } else {
      await this.reportRepo.update(report.id, { status: 'pending', error: 'Falha ao enviar ao grupo' });
    }
    return sent;
  }

  // ───────────────────────── Admin ─────────────────────────

  listClients(): Promise<TrafficReportClient[]> {
    return this.clientRepo.find({ order: { name: 'ASC' } });
  }

  async saveClient(body: Partial<TrafficReportClient> & { id?: string }): Promise<TrafficReportClient> {
    const existing = body.id ? await this.clientRepo.findOne({ where: { id: body.id } }) : null;
    const row = existing ?? this.clientRepo.create({ requireApproval: true, active: true });
    if (body.name !== undefined) row.name = String(body.name).trim();
    if (body.adAccountId !== undefined) row.adAccountId = String(body.adAccountId).replace(/\D/g, '');
    if (body.groupJid !== undefined) row.groupJid = String(body.groupJid).trim();
    if (body.approverPhone !== undefined) row.approverPhone = String(body.approverPhone).replace(/\D/g, '');
    if (body.requireApproval !== undefined) row.requireApproval = !!body.requireApproval;
    if (body.active !== undefined) row.active = !!body.active;
    if (body.nextReportDate !== undefined) row.nextReportDate = String(body.nextReportDate).slice(0, 10);
    return this.clientRepo.save(row);
  }

  // Gera agora o relatório dos 7 dias anteriores, sem alterar a data do próximo envio.
  async generateNow(clientId: string): Promise<TrafficReport | null> {
    const client = await this.clientRepo.findOne({ where: { id: clientId } });
    if (!client) return null;
    return this.generate(client, this.todayBrt());
  }

  // ───────────────────────── Infra ─────────────────────────

  private todayBrt(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
  }

  private serverUrl(): string {
    return (this.config.get<string>('SERVER_URL') ?? 'http://localhost:3000').replace(/\/$/, '');
  }

  // Sai pelo número da empresa (mesmo remetente dos lembretes de cobrança e dos grupos).
  private async sendText(numberOrJid: string, text: string): Promise<boolean> {
    const baseUrl = this.config.get<string>('UAZAPI_BASE_URL') ?? '';
    const token = this.config.get<string>('BILLING_SENDER_TOKEN') ?? '';
    if (!baseUrl || !token) {
      this.logger.error('[TRAFFIC-REPORT] UAZAPI_BASE_URL ou BILLING_SENDER_TOKEN não configurados');
      return false;
    }
    try {
      await firstValueFrom(
        this.http.post(`${baseUrl}/send/text`, { number: numberOrJid, text }, { headers: { token }, timeout: 30000 }),
      );
      return true;
    } catch (err: any) {
      this.logger.error(`[TRAFFIC-REPORT] Falha ao enviar para ${numberOrJid} [HTTP ${err?.response?.status ?? 'N/A'}]: ${err.message}`);
      return false;
    }
  }
}
