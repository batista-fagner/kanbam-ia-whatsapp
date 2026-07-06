import { Controller, Post, Get, Patch, Delete, Body, Param, Query, UseGuards, BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UazapiProvider } from './providers/uazapi.provider';
import { WhatsappConfigService } from './whatsapp-config.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { UsersService } from '../auth/users.service';
import { LeadsService } from '../leads/leads.service';
import { TokenUsage } from '../common/entities/token-usage.entity';
import { Lead } from '../common/entities/lead.entity';
import { Message } from '../common/entities/message.entity';
import { Conversation } from '../common/entities/conversation.entity';

// Todos os endpoints aqui exigem usuário admin (dono da plataforma).
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly uazapi: UazapiProvider,
    private readonly whatsappConfigService: WhatsappConfigService,
    private readonly usersService: UsersService,
    private readonly leadsService: LeadsService,
    private readonly config: ConfigService,
    @InjectRepository(TokenUsage) private readonly tokenUsageRepo: Repository<TokenUsage>,
    @InjectRepository(Lead) private readonly leadRepo: Repository<Lead>,
    @InjectRepository(Message) private readonly messageRepo: Repository<Message>,
    @InjectRepository(Conversation) private readonly conversationRepo: Repository<Conversation>,
  ) {}

  // Cria um cliente novo: tenant (whatsapp_config) + usuário operador ligado a ele.
  // A senha é definida pelo admin e repassada ao cliente (ele troca depois em /auth/change-password).
  @Post('clients')
  async createClient(@Body() body: { name: string; email: string; password: string; agentType?: string; billingPhone?: string }) {
    if (!body?.name?.trim()) throw new BadRequestException('Nome do cliente é obrigatório');
    if (!body?.email?.trim()) throw new BadRequestException('Email é obrigatório');
    if (!body?.password || body.password.length < 5) throw new BadRequestException('Senha mínima de 5 caracteres');

    const existing = await this.usersService.findByEmail(body.email);
    if (existing) throw new ConflictException('Já existe um usuário com esse email');

    // 1. Cria o tenant (linha nova — não sobrescreve nenhum cliente existente)
    const tenant = await this.whatsappConfigService.createTenant(body.name.trim(), body.agentType ?? 'megahair');

    // Salva billingPhone se informado na criação
    if (body.billingPhone?.trim()) {
      await this.whatsappConfigService.updateBilling(tenant.id, { billingPhone: body.billingPhone.trim() });
    }

    // 2. Cria o usuário operador ligado ao tenant
    const user = await this.usersService.create({
      email: body.email,
      password: body.password,
      name: body.name.trim(),
      tenantId: tenant.id,
      role: 'operator',
    });

    return {
      tenant: { id: tenant.id, displayName: tenant.displayName },
      user: { id: user.id, email: user.email },
    };
  }

  // Lista todos os clientes com status (conexão, isActive, vencimento, nº leads/usuários)
  @Get('clients')
  async listClients() {
    const tenants = await this.whatsappConfigService.listAll();
    const result: any[] = [];
    for (const t of tenants) {
      const leadsCount = await this.leadsService.countByTenant(t.id);
      const users = await this.usersService.findByTenant(t.id);
      result.push({
        id: t.id,
        displayName: t.displayName ?? t.profileName,
        email: users[0]?.email ?? null,
        phone: t.phone,
        connected: t.connected,
        isActive: t.isActive,
        nextPaymentDate: t.nextPaymentDate,
        billingDay: t.billingDay,
        billingPhone: t.billingPhone,
        agentType: t.agentType,
        paymentMethod: t.paymentMethod,
        planStatus: t.planStatus,
        leadsCount,
        usersCount: users.length,
      });
    }
    return result;
  }

  // Remove um cliente (tenant + usuários). Recusa se houver leads cadastrados ou prompt configurado.
  @Delete('clients/:id')
  async deleteClient(@Param('id') id: string) {
    const leadsCount = await this.leadsService.countByTenant(id);
    if (leadsCount > 0) throw new BadRequestException(`Cliente tem ${leadsCount} leads — remova os leads antes ou suspenda ao invés de deletar.`);
    const tenant = await this.whatsappConfigService.getByTenant(id);
    const hasPrompt = tenant?.customPromptMegaHair?.trim();
    if (hasPrompt) throw new BadRequestException('Cliente tem prompt configurado — limpe o prompt antes de deletar.');
    await this.usersService.deleteByTenant(id);
    await this.whatsappConfigService.deleteTenant(id);
    return { ok: true };
  }

  // Ativa/suspende um cliente (controle manual de inadimplência)
  @Patch('clients/:id/active')
  async setActive(@Param('id') id: string, @Body() body: { isActive: boolean }) {
    const updated = await this.whatsappConfigService.setActive(id, body.isActive);
    if (!updated) throw new BadRequestException('Cliente não encontrado');
    return { ok: true, isActive: updated.isActive };
  }

  // Admin reseta a senha de um cliente (sem exigir a senha atual).
  @Patch('clients/:id/reset-password')
  async resetPassword(@Param('id') tenantId: string, @Body() body: { newPassword: string }) {
    if (!body.newPassword || body.newPassword.length < 5) throw new BadRequestException('Senha mínima de 5 caracteres');
    const users = await this.usersService.findByTenant(tenantId);
    if (!users.length) throw new BadRequestException('Nenhum usuário encontrado para este cliente');
    // Reseta a senha de todos os usuários do tenant (geralmente 1)
    await Promise.all(users.map(u => this.usersService.resetPassword(u.id, body.newPassword)));
    return { ok: true, usersUpdated: users.length };
  }

  // Remove manualmente a tag "PIX em atraso" (não mexe em isActive/suspensão)
  @Patch('clients/:id/clear-past-due')
  async clearPastDue(@Param('id') id: string) {
    const updated = await this.whatsappConfigService.clearPastDue(id);
    if (!updated) throw new BadRequestException('Cliente não encontrado');
    return { ok: true };
  }

  // Atualiza dados de cobrança (data de vencimento + telefone de contato)
  @Patch('clients/:id/billing')
  async updateBilling(@Param('id') id: string, @Body() body: { nextPaymentDate?: string | null; billingPhone?: string | null }) {
    const updated = await this.whatsappConfigService.updateBilling(id, body);
    if (!updated) throw new BadRequestException('Cliente não encontrado');
    return { ok: true };
  }

  // Retorna uso de tokens por tenant por dia dentro de um range (from..to).
  // Sem params: usa o dia de hoje (fuso de Brasília). Ordenado por data desc.
  @Get('usage')
  async getUsage(@Query('from') from?: string, @Query('to') to?: string) {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    const dateFrom = from ?? today;
    const dateTo = to ?? today;
    const rows = await this.tokenUsageRepo.query(`
      SELECT
        tu.tenant_id,
        COALESCE(wc.display_name, wc.profile_name, tu.tenant_id::text) AS tenant_name,
        TO_CHAR(tu.date, 'YYYY-MM-DD') AS date,
        tu.input_tokens,
        tu.cached_tokens,
        tu.output_tokens,
        tu.cost_usd
      FROM token_usage tu
      LEFT JOIN whatsapp_config wc ON wc.id = tu.tenant_id
      WHERE tu.date BETWEEN $1 AND $2
      ORDER BY tu.date DESC, tu.cost_usd DESC
    `, [dateFrom, dateTo]);
    return rows;
  }

  // ─── Monitoring endpoints ────────────────────────────────────────────────

  // Data de hoje no fuso de Brasília ('YYYY-MM-DD').
  private brToday(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  }

  // created_at é UTC (timestamp sem tz) → converte para BRT e compara a data.
  // Usado para filtrar mensagens pelo "dia de Brasília" (não janela rolante de 24h).
  private readonly MSG_DATE_BRT = `(m.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date = $1`;

  @Get('monitoring/overview')
  async monitoringOverview(@Query('date') date?: string) {
    const day = date ?? this.brToday();
    const rows = await this.tokenUsageRepo.query(`
      SELECT
        COALESCE(SUM(input_tokens), 0)::int  AS total_input,
        COALESCE(SUM(cached_tokens), 0)::int AS total_cached,
        COALESCE(SUM(output_tokens), 0)::int AS total_output,
        COALESCE(SUM(cost_usd), 0)           AS total_cost,
        COUNT(DISTINCT tenant_id)::int        AS active_tenants,
        COALESCE(SUM(cost_usd) FILTER (WHERE engine = 'monolith'), 0)    AS cost_monolith,
        COALESCE(SUM(cost_usd) FILTER (WHERE engine = 'multi_agent'), 0) AS cost_multi_agent
      FROM token_usage WHERE date = $1
    `, [day]);

    // Leads com >=100 msgs inbound no dia (possíveis loops)
    const anomalies = await this.messageRepo.query(`
      SELECT l.id, l.name, l.phone, wc.display_name AS tenant_name, COUNT(m.id)::int AS msg_count
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      JOIN leads l ON c.lead_id = l.id
      JOIN whatsapp_config wc ON l.tenant_id = wc.id
      WHERE ${this.MSG_DATE_BRT}
        AND m.direction = 'inbound'
      GROUP BY l.id, l.name, l.phone, wc.display_name
      HAVING COUNT(m.id) >= 100
      ORDER BY msg_count DESC
    `, [day]);

    return { ...rows[0], date: day, anomaly_count: anomalies.length, anomalies };
  }

  @Get('monitoring/tenants')
  async monitoringTenants(@Query('date') date?: string) {
    const day = date ?? this.brToday();

    const tenantStats = await this.tokenUsageRepo.query(`
      SELECT
        wc.id AS tenant_id,
        COALESCE(wc.display_name, wc.profile_name, wc.id::text) AS tenant_name,
        COALESCE(SUM(CASE WHEN tu.date = $1 THEN tu.input_tokens  ELSE 0 END), 0)::int AS input_today,
        COALESCE(SUM(CASE WHEN tu.date = $1 THEN tu.cached_tokens ELSE 0 END), 0)::int AS cached_today,
        COALESCE(SUM(CASE WHEN tu.date = $1 THEN tu.output_tokens ELSE 0 END), 0)::int AS output_today,
        COALESCE(SUM(CASE WHEN tu.date = $1 THEN tu.cost_usd      ELSE 0 END), 0)      AS cost_today,
        COALESCE(SUM(CASE WHEN tu.date >= ($1::date - 6) AND tu.date <= $1 THEN tu.cost_usd ELSE 0 END), 0) AS cost_7d,
        COUNT(DISTINCT tu.date) FILTER (WHERE tu.date >= ($1::date - 6) AND tu.date <= $1) AS active_days_7d,
        -- Quebra por motor (monólito x multi-agente) — pra acompanhar a migração gradual.
        COALESCE(SUM(CASE WHEN tu.date = $1 AND tu.engine = 'monolith'    THEN tu.cost_usd ELSE 0 END), 0) AS cost_today_monolith,
        COALESCE(SUM(CASE WHEN tu.date = $1 AND tu.engine = 'multi_agent' THEN tu.cost_usd ELSE 0 END), 0) AS cost_today_multi_agent,
        COALESCE(SUM(CASE WHEN tu.date = $1 AND tu.engine = 'monolith'    THEN tu.input_tokens ELSE 0 END), 0)::int AS input_today_monolith,
        COALESCE(SUM(CASE WHEN tu.date = $1 AND tu.engine = 'multi_agent' THEN tu.input_tokens ELSE 0 END), 0)::int AS input_today_multi_agent
      FROM whatsapp_config wc
      LEFT JOIN token_usage tu ON tu.tenant_id = wc.id
      GROUP BY wc.id, wc.display_name, wc.profile_name
      ORDER BY cost_today DESC
    `, [day]);

    // Top lead por msgs inbound no dia, por tenant
    const topLeads = await this.messageRepo.query(`
      SELECT l.tenant_id, l.name AS lead_name, COUNT(m.id)::int AS msg_count
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      JOIN leads l ON c.lead_id = l.id
      WHERE ${this.MSG_DATE_BRT}
        AND m.direction = 'inbound'
      GROUP BY l.tenant_id, l.name
      ORDER BY msg_count DESC
    `, [day]);

    const topLeadByTenant: Record<string, any> = {};
    for (const row of topLeads) {
      if (!topLeadByTenant[row.tenant_id]) topLeadByTenant[row.tenant_id] = row;
    }

    return tenantStats.map(t => {
      const cacheRate = t.input_today > 0 ? Math.round(t.cached_today / t.input_today * 100) : null;
      const projectedMonthly = t.active_days_7d > 0 ? (t.cost_7d / t.active_days_7d) * 30 : 0;
      return {
        ...t,
        cache_pct: cacheRate,
        projected_monthly: projectedMonthly,
        top_lead: topLeadByTenant[t.tenant_id] ?? null,
      };
    });
  }

  @Get('monitoring/top-leads')
  async monitoringTopLeads(@Query('date') date?: string) {
    const day = date ?? this.brToday();
    return this.messageRepo.query(`
      SELECT
        l.id, l.name, l.phone, l.stage,
        wc.display_name AS tenant_name,
        COUNT(m.id)::int AS msg_count,
        COUNT(m.id) FILTER (WHERE m.direction = 'inbound')::int  AS inbound_count,
        COUNT(m.id) FILTER (WHERE m.direction = 'outbound')::int AS outbound_count,
        MIN(m.created_at) AS first_msg_today,
        MAX(m.created_at) AS last_msg_today,
        (COUNT(m.id) >= 100) AS is_anomaly
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      JOIN leads l ON c.lead_id = l.id
      JOIN whatsapp_config wc ON l.tenant_id = wc.id
      WHERE ${this.MSG_DATE_BRT}
      GROUP BY l.id, l.name, l.phone, l.stage, wc.display_name
      ORDER BY msg_count DESC
      LIMIT 20
    `, [day]);
  }

  @Get('monitoring/token-history')
  async monitoringTokenHistory() {
    return this.tokenUsageRepo.query(`
      SELECT
        TO_CHAR(date, 'YYYY-MM-DD') AS date,
        SUM(input_tokens)::int  AS total_input,
        SUM(cached_tokens)::int AS total_cached,
        SUM(output_tokens)::int AS total_output,
        SUM(cost_usd)           AS total_cost,
        COALESCE(SUM(cost_usd) FILTER (WHERE engine = 'monolith'), 0)    AS cost_monolith,
        COALESCE(SUM(cost_usd) FILTER (WHERE engine = 'multi_agent'), 0) AS cost_multi_agent
      FROM token_usage
      WHERE date >= CURRENT_DATE - INTERVAL '14 days'
      GROUP BY date
      ORDER BY date ASC
    `);
  }

  @Get('monitoring/media')
  async monitoringMedia(@Query('date') date?: string) {
    const day = date ?? this.brToday();

    // Vídeos enviados por tenant no dia
    const byTenant = await this.messageRepo.query(`
      SELECT
        l.tenant_id,
        COALESCE(wc.display_name, wc.profile_name, l.tenant_id::text) AS tenant_name,
        wc.media_limit_per_day AS daily_limit,
        COUNT(m.id)::int AS videos_sent
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      JOIN leads l ON c.lead_id = l.id
      JOIN whatsapp_config wc ON l.tenant_id = wc.id
      WHERE ${this.MSG_DATE_BRT}
        AND m.direction = 'outbound'
        AND m.content LIKE '[mídia:%'
      GROUP BY l.tenant_id, wc.display_name, wc.profile_name, wc.media_limit_per_day
      ORDER BY videos_sent DESC
    `, [day]);

    // Histórico de vídeos 14 dias (total por dia)
    const history = await this.messageRepo.query(`
      SELECT
        TO_CHAR((m.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD') AS date,
        COUNT(m.id)::int AS total_videos
      FROM messages m
      WHERE m.direction = 'outbound'
        AND m.content LIKE '[mídia:%'
        AND m.created_at >= NOW() - INTERVAL '14 days'
      GROUP BY (m.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date
      ORDER BY date ASC
    `);

    const totalToday = byTenant.reduce((sum: number, t: any) => sum + Number(t.videos_sent), 0);

    return { date: day, total_today: totalToday, by_tenant: byTenant, history };
  }

  // ────────────────────────────────────────────────────────────────────────

  @Get('instances')
  async listInstances() {
    return this.whatsappConfigService.listAll();
  }

  // Cria/conecta a instância uazapi (usado na implementação assistida).
  @Post('instance')
  async createInstance(@Body() body: { name: string; adminField01?: string; adminField02?: string }) {
    if (!body?.name) return { error: 'name é obrigatório' };
    return this.whatsappConfigService.createNewInstance(body.name, body.adminField01, body.adminField02);
  }

  @Post('global-webhook')
  async configureGlobalWebhook(@Body() body: { url?: string; events?: string[]; excludeMessages?: string[] }) {
    const serverUrl = this.config.get('SERVER_URL') ?? 'http://localhost:3000';
    const url = body?.url ?? `${serverUrl}/webhooks/uazapi`;
    const events = body?.events ?? ['messages', 'connection'];
    const excludeMessages = body?.excludeMessages ?? ['wasSentByApi', 'isGroupYes'];
    return this.uazapi.configureGlobalWebhook(url, events, excludeMessages);
  }
}
