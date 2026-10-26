import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { Repository } from 'typeorm';
import OpenAI from 'openai';
import { SalesReport } from '../common/entities/sales-report.entity';
import { WhatsappConfig } from '../common/entities/whatsapp-config.entity';
import { LeadsGateway } from '../leads/leads.gateway';
import { SalesReportPdfService } from './sales-report-pdf.service';
import {
  buildSystemPrompt, buildTranscript, buildUserPrompt, estimateCostUsd, parseReportContent,
  ReportConversation, ReportMetrics, SalesReportContent,
} from './sales-report.prompt';

// Piloto: só a DALU tem o relatório. Para liberar outro cliente, incluir o id aqui (e no
// SALES_REPORT_TENANT_IDS do frontend, Layout.jsx) ou na env SALES_REPORT_EXTRA_TENANT_IDS
// (ids separados por vírgula — libera sem deploy; o menu aparece pela rota /sales-report).
export const SALES_REPORT_TENANT_IDS = ['d69c3b3a-5b96-4c7d-9bce-ea7c44533d5c'];

// Regra de uso (vai mudar): 1 relatório por janela de 7 dias, analisando os últimos 7 dias.
// Admin gera sem limite (teste/suporte).
export const SALES_REPORT_RULES = { periodDays: 7, maxPerWindow: 1, windowDays: 7 };

const DAY_MS = 24 * 3600_000;
// Geração presa (processo reiniciou no meio) vira 'failed' na subida — não conta no limite.
const STALE_PROCESSING_MS = 15 * 60_000;
const PRIMARY_MODEL = 'gemini-2.5-flash';
const FALLBACK_MODEL = 'gpt-4o-mini';

export interface SalesReportStatus {
  enabled: boolean;
  canGenerate: boolean;
  processing: boolean;
  nextAvailableAt: string | null;
  notificationPhone: string | null;
  rules: typeof SALES_REPORT_RULES;
}

@Injectable()
export class SalesReportService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SalesReportService.name);
  private readonly gemini: OpenAI | null;
  private readonly openai: OpenAI | null;

  constructor(
    @InjectRepository(SalesReport) private readonly reportRepo: Repository<SalesReport>,
    @InjectRepository(WhatsappConfig) private readonly configRepo: Repository<WhatsappConfig>,
    private readonly pdf: SalesReportPdfService,
    private readonly gateway: LeadsGateway,
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    const geminiKey = config.get<string>('GEMINI_API_KEY');
    const openaiKey = config.get<string>('OPENAI_API_KEY');
    this.gemini = geminiKey ? new OpenAI({ apiKey: geminiKey, baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/' }) : null;
    this.openai = openaiKey ? new OpenAI({ apiKey: openaiKey }) : null;
  }

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.reportRepo.query(
        `UPDATE sales_reports SET status = 'failed', error = 'Geração interrompida (servidor reiniciou). Tente de novo.'
          WHERE status = 'processing' AND created_at < now() - ($1 || ' milliseconds')::interval`,
        [STALE_PROCESSING_MS],
      );
    } catch (err: any) {
      this.logger.warn(`[SALES-REPORT] Não consegui limpar gerações presas: ${err.message}`);
    }
  }

  isEnabled(tenantId: string | null | undefined): boolean {
    if (!tenantId) return false;
    const extra = (this.config.get<string>('SALES_REPORT_EXTRA_TENANT_IDS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    return SALES_REPORT_TENANT_IDS.includes(tenantId) || extra.includes(tenantId);
  }

  async status(tenantId: string, isAdmin: boolean): Promise<SalesReportStatus> {
    const cfg = await this.configRepo.findOne({ where: { id: tenantId } });
    const base = { notificationPhone: cfg?.notificationPhone ?? null, rules: SALES_REPORT_RULES };
    if (!this.isEnabled(tenantId)) return { ...base, enabled: false, canGenerate: false, processing: false, nextAvailableAt: null };

    const processing = !!(await this.reportRepo.findOne({ where: { tenantId, status: 'processing' } }));
    const recent: Array<{ created_at: Date }> = await this.reportRepo.query(
      `SELECT created_at FROM sales_reports
        WHERE tenant_id = $1 AND status = 'done' AND created_at > now() - ($2 || ' days')::interval
        ORDER BY created_at ASC`,
      [tenantId, SALES_REPORT_RULES.windowDays],
    );
    const used = recent.length;
    const nextAvailableAt = used >= SALES_REPORT_RULES.maxPerWindow
      ? new Date(new Date(recent[0].created_at).getTime() + SALES_REPORT_RULES.windowDays * DAY_MS).toISOString()
      : null;
    const canGenerate = !processing && (isAdmin || used < SALES_REPORT_RULES.maxPerWindow);
    return { ...base, enabled: true, canGenerate, processing, nextAvailableAt: isAdmin ? null : nextAvailableAt };
  }

  async list(tenantId: string) {
    if (!this.isEnabled(tenantId)) return [];
    return this.reportRepo.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
      take: 30,
      select: ['id', 'status', 'periodStart', 'periodEnd', 'createdAt', 'pdfSentTo', 'pdfError', 'error'],
    });
  }

  async get(id: string, tenantId: string) {
    const r = await this.reportRepo.findOne({ where: { id, tenantId } });
    if (!r) throw new NotFoundException('Relatório não encontrado');
    // Custo é do Monitoramento (admin), não aparece pra cliente.
    const { costUsd, inputTokens, cachedTokens, outputTokens, model, ...rest } = r;
    return rest;
  }

  // Cria o relatório e gera em segundo plano (a IA leva de 30s a 2min). A tela acompanha
  // pelo socket 'sales-report:updated'.
  async request(tenantId: string, userId: string | null, isAdmin: boolean): Promise<SalesReport> {
    if (!this.isEnabled(tenantId)) throw new ForbiddenException('Relatório não disponível para esta conta');
    const st = await this.status(tenantId, isAdmin);
    if (st.processing) throw new ConflictException('Já existe um relatório sendo gerado');
    if (!st.canGenerate) throw new ConflictException('Limite semanal atingido');

    const periodEnd = new Date();
    const periodStart = new Date(periodEnd.getTime() - SALES_REPORT_RULES.periodDays * DAY_MS);
    let report: SalesReport;
    try {
      report = await this.reportRepo.save(this.reportRepo.create({ tenantId, periodStart, periodEnd, status: 'processing', createdBy: userId }));
    } catch {
      // Índice único parcial: duas solicitações ao mesmo tempo.
      throw new ConflictException('Já existe um relatório sendo gerado');
    }
    void this.generate(report.id).catch((err) =>
      this.logger.error(`[SALES-REPORT] Falha inesperada no relatório ${report.id}: ${err?.message ?? err}`));
    return report;
  }

  async buildPdf(id: string, tenantId: string): Promise<{ buffer: Buffer; fileName: string }> {
    const r = await this.reportRepo.findOne({ where: { id, tenantId } });
    if (!r || r.status !== 'done' || !r.content || !r.metrics) throw new NotFoundException('Relatório não encontrado');
    const cfg = await this.configRepo.findOne({ where: { id: tenantId } });
    const buffer = await this.pdf.build({
      businessName: this.businessName(cfg),
      periodLabel: this.periodLabel(r.periodStart, r.periodEnd),
      metrics: r.metrics as ReportMetrics,
      content: r.content as SalesReportContent,
    });
    return { buffer, fileName: this.fileName(r) };
  }

  // Lista do Monitoramento (admin): todo relatório gerado, com custo estimado.
  async listForMonitoring(from: string, to: string) {
    return this.reportRepo.query(
      `SELECT r.id, r.tenant_id, COALESCE(wc.display_name, wc.profile_name, r.tenant_id::text) AS tenant_name,
              r.status, r.model, r.input_tokens, r.cached_tokens, r.output_tokens, r.cost_usd::float AS cost_usd,
              r.created_at, r.pdf_sent_to IS NOT NULL AS pdf_sent
         FROM sales_reports r
         LEFT JOIN whatsapp_config wc ON wc.id = r.tenant_id
        WHERE (r.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN $1 AND $2
        ORDER BY r.created_at DESC`,
      [from, to],
    );
  }

  // ───────────────────────── Geração ─────────────────────────

  private async generate(id: string): Promise<void> {
    const report = await this.reportRepo.findOne({ where: { id } });
    if (!report) return;
    const cfg = await this.configRepo.findOne({ where: { id: report.tenantId } });
    try {
      const { conversations, metrics } = await this.collect(report.tenantId, report.periodStart, report.periodEnd);
      const transcript = buildTranscript(conversations);
      const periodLabel = this.periodLabel(report.periodStart, report.periodEnd);
      const ai = await this.callAi(buildSystemPrompt(this.businessName(cfg)), buildUserPrompt(metrics, periodLabel, transcript));
      const content = parseReportContent(ai.text);
      const costUsd = estimateCostUsd(ai.model, ai.inputTokens, ai.cachedTokens, ai.outputTokens);

      await this.reportRepo.update(id, {
        status: 'done', content: content as any, metrics: metrics as any, model: ai.model,
        inputTokens: ai.inputTokens, cachedTokens: ai.cachedTokens, outputTokens: ai.outputTokens, costUsd,
      });
      await this.trackUsage(report.tenantId, ai.inputTokens, ai.cachedTokens, ai.outputTokens, costUsd);
      this.logger.log(`[SALES-REPORT] Pronto ${id} (tenant ${report.tenantId}): ${transcript.included} conversas, ${ai.inputTokens}+${ai.outputTokens} tokens, US$ ${costUsd.toFixed(4)}`);
      this.gateway.emitSalesReport(report.tenantId, { id, status: 'done' });

      await this.sendPdf(id, report.tenantId, cfg);
    } catch (err: any) {
      this.logger.error(`[SALES-REPORT] Falhou ${id}: ${err?.message ?? err}`);
      await this.reportRepo.update(id, { status: 'failed', error: 'Não foi possível gerar o relatório agora. Tente de novo em alguns minutos.' });
      this.gateway.emitSalesReport(report.tenantId, { id, status: 'failed' });
    }
  }

  private async collect(tenantId: string, from: Date, to: Date): Promise<{ conversations: ReportConversation[]; metrics: ReportMetrics }> {
    const rows: Array<{ lead_id: string; name: string | null; stage: string; temperature: string | null; direction: 'inbound' | 'outbound'; sender: string; content: string; created_at: Date }> =
      await this.reportRepo.query(
        `SELECT c.lead_id, l.name, l.stage, l.temperature, m.direction, m.sender, m.content, m.created_at
           FROM messages m
           JOIN conversations c ON c.id = m.conversation_id
           JOIN leads l ON l.id = c.lead_id
          WHERE l.tenant_id = $1 AND m.created_at >= $2 AND m.created_at < $3
          ORDER BY m.created_at ASC
          LIMIT 30000`,
        [tenantId, from, to],
      );

    const byLead = new Map<string, ReportConversation>();
    let inbound = 0, ai = 0, team = 0;
    // Um balde por dia do período (fuso de Brasília), na ordem — inclusive dia sem mensagem.
    const dayKey = (d: Date) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }).format(d);
    const porDia = new Map<string, { dia: string; recebidas: number; ia: number; equipe: number }>();
    for (let t = from.getTime(); t < to.getTime() + DAY_MS; t += DAY_MS) {
      const k = dayKey(new Date(Math.min(t, to.getTime())));
      if (!porDia.has(k)) porDia.set(k, { dia: k, recebidas: 0, ia: 0, equipe: 0 });
    }
    const leadsWithTeam = new Set<string>();
    for (const r of rows) {
      let conv = byLead.get(r.lead_id);
      if (!conv) {
        conv = { leadName: r.name, stage: r.stage, temperature: r.temperature, messages: [] };
        byLead.set(r.lead_id, conv);
      }
      conv.messages.push({ direction: r.direction, sender: r.sender, content: r.content, createdAt: new Date(r.created_at) });
      const bucket = porDia.get(dayKey(new Date(r.created_at)));
      if (r.direction === 'inbound') { inbound++; if (bucket) bucket.recebidas++; }
      else if (r.sender === 'ai') { ai++; if (bucket) bucket.ia++; }
      else { team++; leadsWithTeam.add(r.lead_id); if (bucket) bucket.equipe++; }
    }

    const [{ novos }] = await this.reportRepo.query(
      `SELECT COUNT(*)::int AS novos FROM leads WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3`, [tenantId, from, to]);
    const stageRows: Array<{ to_stage: string; n: number }> = await this.reportRepo.query(
      `SELECT h.to_stage, COUNT(DISTINCT h.lead_id)::int AS n
         FROM lead_stage_history h JOIN leads l ON l.id = h.lead_id
        WHERE l.tenant_id = $1 AND h.created_at >= $2 AND h.created_at < $3 AND h.to_stage IN ('agendado', 'vendas', 'perdido')
        GROUP BY h.to_stage`,
      [tenantId, from, to],
    );
    const stage = (s: string) => stageRows.find((x) => x.to_stage === s)?.n ?? 0;
    const [{ aguardando }] = await this.reportRepo.query(
      `SELECT COUNT(*)::int AS aguardando FROM leads
        WHERE tenant_id = $1 AND last_message_direction = 'inbound' AND last_message_at >= $2`, [tenantId, from]);

    return {
      conversations: [...byLead.values()],
      metrics: {
        conversas: byLead.size, novosLeads: novos, mensagensRecebidas: inbound, respostasIa: ai, respostasEquipe: team,
        conversasComEquipe: leadsWithTeam.size, agendados: stage('agendado'), vendas: stage('vendas'), perdidos: stage('perdido'),
        aguardandoResposta: aguardando,
        porDia: [...porDia.values()],
      },
    };
  }

  private async callAi(system: string, user: string): Promise<{ text: string; model: string; inputTokens: number; cachedTokens: number; outputTokens: number }> {
    const attempts: Array<{ client: OpenAI | null; model: string; extra: Record<string, any> }> = [
      // Um pouco de raciocínio ajuda numa análise longa; o custo entra no output e é contado.
      { client: this.gemini, model: PRIMARY_MODEL, extra: { reasoning_effort: 'low', max_tokens: 12000 } },
      { client: this.openai, model: FALLBACK_MODEL, extra: { max_tokens: 6000 } },
    ];
    let lastErr: any;
    for (const a of attempts) {
      if (!a.client) continue;
      try {
        const resp: any = await a.client.chat.completions.create({
          model: a.model,
          response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          ...a.extra,
        } as any);
        const text = resp.choices?.[0]?.message?.content ?? '';
        parseReportContent(text); // JSON inválido → tenta o próximo modelo
        const usage = resp.usage ?? {};
        return {
          text, model: a.model,
          inputTokens: usage.prompt_tokens ?? 0,
          cachedTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
          outputTokens: usage.completion_tokens ?? 0,
        };
      } catch (err: any) {
        lastErr = err;
        this.logger.warn(`[SALES-REPORT] Modelo ${a.model} falhou: ${err?.message ?? err}`);
      }
    }
    throw lastErr ?? new Error('Nenhum provedor de IA configurado');
  }

  // Entra no mesmo token_usage do resto do sistema (engine própria): o custo do relatório
  // soma no consumo do cliente no Monitoramento e no Financeiro.
  private async trackUsage(tenantId: string, input: number, cached: number, output: number, cost: number): Promise<void> {
    try {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
      await this.reportRepo.query(
        `INSERT INTO token_usage (tenant_id, date, engine, input_tokens, cached_tokens, output_tokens, cost_usd)
         VALUES ($1, $2, 'sales_report', $3, $4, $5, $6)
         ON CONFLICT (tenant_id, date, engine) DO UPDATE SET
           input_tokens  = token_usage.input_tokens  + EXCLUDED.input_tokens,
           cached_tokens = token_usage.cached_tokens + EXCLUDED.cached_tokens,
           output_tokens = token_usage.output_tokens + EXCLUDED.output_tokens,
           cost_usd      = token_usage.cost_usd      + EXCLUDED.cost_usd`,
        [tenantId, today, input, cached, output, cost],
      );
    } catch (err: any) {
      this.logger.error(`[SALES-REPORT] Falha ao registrar consumo: ${err.message}`);
    }
  }

  // PDF para o WhatsApp de notificações (Configurações), enviado pelo número da própria
  // cliente. Falha aqui não derruba o relatório — fica registrada e aparece na tela.
  private async sendPdf(id: string, tenantId: string, cfg: WhatsappConfig | null): Promise<void> {
    const phone = (cfg?.notificationPhone ?? '').replace(/\D/g, '');
    if (!phone) {
      await this.reportRepo.update(id, { pdfError: 'Sem WhatsApp de notificações cadastrado em Configurações.' });
      return;
    }
    try {
      const { buffer, fileName } = await this.buildPdf(id, tenantId);
      const token = cfg?.instanceToken || this.config.get<string>('UAZAPI_TOKEN') || '';
      await firstValueFrom(this.http.post(
        `${this.config.get<string>('UAZAPI_BASE_URL') ?? ''}/send/media`,
        {
          number: phone,
          type: 'document',
          file: `data:application/pdf;base64,${buffer.toString('base64')}`,
          docName: fileName,
          text: '📊 Seu relatório de vendas da semana está pronto. Ele também fica no CRM, em Relatório de vendas.',
        },
        { headers: { token } },
      ));
      await this.reportRepo.update(id, { pdfSentTo: phone, pdfError: null });
    } catch (err: any) {
      this.logger.error(`[SALES-REPORT] PDF não enviado (${id}) [HTTP ${err?.response?.status ?? 'N/A'}]: ${err.message}`);
      await this.reportRepo.update(id, { pdfError: 'Não consegui enviar o PDF no WhatsApp (o número está conectado?). Baixe pelo CRM.' });
    }
    this.gateway.emitSalesReport(tenantId, { id, status: 'done' });
  }

  private businessName(cfg: WhatsappConfig | null): string {
    return cfg?.displayName?.trim() || cfg?.profileName?.trim() || 'seu negócio';
  }

  periodLabel(start: Date, end: Date): string {
    const f = (d: Date) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
    return `${f(start)} a ${f(end)}`;
  }

  private fileName(r: SalesReport): string {
    const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(r.periodEnd);
    return `relatorio-vendas-${d}.pdf`;
  }
}
