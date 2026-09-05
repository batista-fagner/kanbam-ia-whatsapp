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
import { AgentsService } from '../agents/agents.service';
import { NotFoundException } from '@nestjs/common';
import { BillingEvent } from '../common/entities/billing-event.entity';
import { PromptModule } from '../common/entities/prompt-module.entity';
import { MediaSendError } from '../common/entities/media-send-error.entity';
import { ClientExtraCharge } from '../common/entities/client-extra-charge.entity';

// Todos os endpoints aqui exigem usuário admin (dono da plataforma).
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly uazapi: UazapiProvider,
    private readonly whatsappConfigService: WhatsappConfigService,
    private readonly usersService: UsersService,
    private readonly leadsService: LeadsService,
    private readonly agentsService: AgentsService,
    private readonly config: ConfigService,
    @InjectRepository(TokenUsage) private readonly tokenUsageRepo: Repository<TokenUsage>,
    @InjectRepository(Lead) private readonly leadRepo: Repository<Lead>,
    @InjectRepository(Message) private readonly messageRepo: Repository<Message>,
    @InjectRepository(Conversation) private readonly conversationRepo: Repository<Conversation>,
    @InjectRepository(BillingEvent) private readonly billingEventRepo: Repository<BillingEvent>,
    @InjectRepository(PromptModule) private readonly promptModuleRepo: Repository<PromptModule>,
    @InjectRepository(MediaSendError) private readonly mediaSendErrorRepo: Repository<MediaSendError>,
    @InjectRepository(ClientExtraCharge) private readonly extraChargeRepo: Repository<ClientExtraCharge>,
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
        planValue: t.planValue,
        createdAt: t.createdAt, // "cliente desde" — usado na aba Financeiro
        isTest: t.isTest,
        churnedAt: t.churnedAt,
        churnReason: t.churnReason,
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

  // Remove manualmente a tag "PIX em atraso" (não mexe em isActive/suspensão).
  // Também registra "pagamento confirmado" na aba Cobranças — usado quando o cliente
  // paga por fora do fluxo automático da Efí (ex: PIX direto, dinheiro) e o admin só
  // confirma manualmente; sem isso o pagamento nunca aparecia no histórico de cobrança.
  @Patch('clients/:id/clear-past-due')
  async clearPastDue(@Param('id') id: string) {
    const updated = await this.whatsappConfigService.clearPastDue(id);
    if (!updated) throw new BadRequestException('Cliente não encontrado');
    await this.billingEventRepo.save(
      this.billingEventRepo.create({
        tenantId: id,
        channel: 'pagamento',
        status: 'confirmado',
        amount: updated.planValue ?? null,
        txid: 'manual',
      }),
    );
    return { ok: true };
  }

  // Atualiza dados de cobrança (data de vencimento + telefone de contato + valor do plano)
  @Patch('clients/:id/billing')
  async updateBilling(@Param('id') id: string, @Body() body: { nextPaymentDate?: string | null; billingPhone?: string | null; planValue?: number | null }) {
    const updated = await this.whatsappConfigService.updateBilling(id, body);
    if (!updated) throw new BadRequestException('Cliente não encontrado');
    return { ok: true };
  }

  // Marca/desmarca uma conta como teste do time / lead que nunca pagou — some por completo
  // da tela Financeiro (MRR, receita, listas). Diferente de churn (que fica visível lá).
  @Patch('clients/:id/test-flag')
  async setTestFlag(@Param('id') id: string, @Body() body: { isTest: boolean }) {
    const updated = await this.whatsappConfigService.setTestFlag(id, body.isTest);
    if (!updated) throw new BadRequestException('Cliente não encontrado');
    return { ok: true, isTest: updated.isTest };
  }

  // Marca/desmarca churn manual — cliente que pagou ao menos 1 vez e saiu. Sai do MRR/ativos
  // na tela Financeiro, mas a receita histórica dele continua contando no acumulado.
  @Patch('clients/:id/churn')
  async setChurn(@Param('id') id: string, @Body() body: { churned: boolean; reason?: string }) {
    const updated = await this.whatsappConfigService.setChurn(id, body.churned, body.reason);
    if (!updated) throw new BadRequestException('Cliente não encontrado');
    return { ok: true, churnedAt: updated.churnedAt, churnReason: updated.churnReason };
  }

  // Cobranças avulsas do cliente (upgrades/upsells além da assinatura) — somam na receita
  // dele na tela Financeiro.
  @Get('clients/:id/extra-charges')
  async listExtraCharges(@Param('id') id: string) {
    return this.extraChargeRepo.find({ where: { tenantId: id }, order: { createdAt: 'DESC' } });
  }

  @Post('clients/:id/extra-charges')
  async addExtraCharge(@Param('id') id: string, @Body() body: { description: string; amount: number }) {
    if (!body?.description?.trim()) throw new BadRequestException('Descrição é obrigatória');
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('Valor deve ser maior que zero');
    return this.extraChargeRepo.save(
      this.extraChargeRepo.create({ tenantId: id, description: body.description.trim(), amount: amount.toFixed(2) }),
    );
  }

  @Delete('clients/:id/extra-charges/:chargeId')
  async deleteExtraCharge(@Param('id') id: string, @Param('chargeId') chargeId: string) {
    const result = await this.extraChargeRepo.delete({ id: chargeId, tenantId: id });
    if (!result.affected) throw new BadRequestException('Lançamento não encontrado');
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

  // ─── Financeiro: mapeamento de clientes, receita, custo e margem ──────────

  // Tudo que a aba "Financeiro" precisa, em 3 queries agregadas (nada de N+1 como o
  // /admin/clients faz). Receita = SÓ billing_events channel='pagamento' + status='confirmado';
  // os outros canais ('pix'/'whatsapp'/'email') são tentativa de ENVIO de cobrança, não
  // dinheiro que entrou — somar tudo infla a receita em ~4x.
  @Get('finance/overview')
  async financeOverview(@Query('from') from?: string, @Query('to') to?: string) {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    // Período padrão do custo de token = mês corrente (a receita acumulada é sempre desde o início).
    const dateFrom = from ?? `${today.slice(0, 7)}-01`;
    const dateTo = to ?? today;
    const usdBrl = Number(this.config.get<string>('USD_BRL_RATE') ?? 5.5);

    const clients = await this.billingEventRepo.query(`
      WITH revenue AS (
        SELECT tenant_id, SUM(amount) AS total, MAX(created_at) AS last_payment_at
        FROM billing_events
        WHERE channel = 'pagamento' AND status = 'confirmado' AND tenant_id IS NOT NULL
        GROUP BY tenant_id
      ),
      extra AS (
        -- Cobranças avulsas (upgrades/upsells além da assinatura) lançadas no drawer do cliente.
        SELECT tenant_id, SUM(amount) AS total, MAX(created_at) AS last_charge_at
        FROM client_extra_charges
        GROUP BY tenant_id
      ),
      tokens AS (
        SELECT tenant_id, SUM(cost_usd) AS cost_usd
        FROM token_usage
        WHERE date BETWEEN $1 AND $2
        GROUP BY tenant_id
      )
      SELECT
        wc.id,
        COALESCE(wc.display_name, wc.profile_name, '(sem nome)') AS name,
        wc.origin_source, wc.origin_medium, wc.origin_campaign,
        wc.payment_method, wc.plan_status, wc.is_active,
        wc.churned_at, wc.churn_reason,
        COALESCE(wc.plan_value, 390)::float AS plan_value,
        TO_CHAR(wc.next_payment_date, 'YYYY-MM-DD') AS next_payment_date,
        wc.billing_day,
        TO_CHAR(wc.created_at, 'YYYY-MM-DD') AS client_since,
        (COALESCE(r.total, 0) + COALESCE(e.total, 0))::float AS revenue_total,
        TO_CHAR(GREATEST(r.last_payment_at, e.last_charge_at), 'YYYY-MM-DD') AS last_payment_at,
        COALESCE(t.cost_usd, 0)::float AS token_cost_usd
      FROM whatsapp_config wc
      LEFT JOIN revenue r ON r.tenant_id = wc.id
      LEFT JOIN extra e ON e.tenant_id = wc.id
      LEFT JOIN tokens t ON t.tenant_id = wc.id
      WHERE wc.is_test = false
      ORDER BY (COALESCE(r.total, 0) + COALESCE(e.total, 0)) DESC, wc.created_at DESC
    `, [dateFrom, dateTo]);

    // Receita da empresa inclui os pagamentos sem tenant vinculado (implantação paga antes
    // da conta existir), por isso não é só a soma da coluna por cliente.
    const [totals] = await this.billingEventRepo.query(`
      SELECT
        COALESCE(SUM(amount), 0)::float AS revenue_all_time,
        COALESCE(SUM(amount) FILTER (WHERE created_at >= DATE_TRUNC('month', NOW())), 0)::float AS revenue_this_month
      FROM billing_events
      WHERE channel = 'pagamento' AND status = 'confirmado'
    `);

    const monthly = await this.billingEventRepo.query(`
      SELECT TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
             SUM(amount)::float AS total
      FROM billing_events
      WHERE channel = 'pagamento' AND status = 'confirmado'
      GROUP BY 1
      ORDER BY 1
    `);

    const rows = clients.map((c: any) => {
      const tokenCostBrl = Number(c.token_cost_usd) * usdBrl;
      return {
        ...c,
        token_cost_brl: tokenCostBrl,
        // Margem do período: o que o plano dele rende por mês menos o que ele custa de API.
        margin_brl: Number(c.plan_value) - tokenCostBrl,
      };
    });

    // Churn manual tem prioridade sobre o status derivado — um cliente marcado como churn
    // não conta como ativo/em atraso/perdido, mesmo que plan_status ainda diga outra coisa.
    const churnedRows = rows.filter((c: any) => c.churned_at);
    const nonChurned = rows.filter((c: any) => !c.churned_at);
    const activeRows = nonChurned.filter((c: any) => c.plan_status === 'active' && c.is_active);
    const mrr = activeRows.reduce((sum: number, c: any) => sum + Number(c.plan_value), 0);
    const tokenCostPeriodBrl = rows.reduce((sum: number, c: any) => sum + c.token_cost_brl, 0);
    const churnRevenueTotal = churnedRows.reduce((sum: number, c: any) => sum + Number(c.revenue_total), 0);

    return {
      period: { from: dateFrom, to: dateTo, usdBrl },
      kpis: {
        mrr,
        revenueAllTime: Number(totals?.revenue_all_time ?? 0),
        revenueThisMonth: Number(totals?.revenue_this_month ?? 0),
        tokenCostPeriodBrl,
        marginThisMonth: Number(totals?.revenue_this_month ?? 0) - tokenCostPeriodBrl,
        activeCount: activeRows.length,
        pastDueCount: nonChurned.filter((c: any) => ['past_due', 'expired', 'pending'].includes(c.plan_status)).length,
        lostCount: nonChurned.filter((c: any) => c.plan_status === 'canceled' || !c.is_active).length,
        churnCount: churnedRows.length,
        churnRevenueTotal,
        totalCount: rows.length,
      },
      monthly,
      clients: rows,
    };
  }

  // Preenche a origem (UTM) dos clientes cruzando por telefone com o banco do convertHairCRM,
  // onde o lead original guarda a campanha que trouxe a pessoa. Roda sob demanda (botão na
  // tela) — o app não fica acoplado ao outro banco em runtime.
  @Post('finance/sync-origins')
  async syncOrigins() {
    const url = this.config.get<string>('CONVERTHAIRCRM_DATABASE_URL');
    if (!url) throw new BadRequestException('CONVERTHAIRCRM_DATABASE_URL não configurada');

    // Só clientes que ainda não têm origem — quem veio com UTM do checkout não é sobrescrito.
    const pending = await this.billingEventRepo.query(`
      SELECT id, billing_phone
      FROM whatsapp_config
      WHERE origin_source IS NULL AND billing_phone IS NOT NULL
    `);
    if (pending.length === 0) return { checked: 0, updated: 0, notFound: 0 };

    const { Client } = await import('pg');
    const crm = new Client({ connectionString: url });
    await crm.connect();
    let updated = 0;
    try {
      for (const row of pending) {
        // Compara pelos 8 últimos dígitos: os dois bancos gravam o telefone em formatos
        // diferentes (com/sem 55, com/sem o 9 extra).
        const last8 = String(row.billing_phone).replace(/\D/g, '').slice(-8);
        if (last8.length < 8) continue;
        const found = await crm.query(
          `SELECT utm_source, utm_medium, utm_campaign, quiz_slug
           FROM leads
           WHERE regexp_replace(phone, '\\D', '', 'g') LIKE '%' || $1
           ORDER BY created_at ASC LIMIT 1`,
          [last8],
        );
        const lead = found.rows[0];
        if (!lead?.utm_source && !lead?.quiz_slug) continue;
        await this.billingEventRepo.query(
          `UPDATE whatsapp_config
           SET origin_source = $2, origin_medium = $3, origin_campaign = $4, origin_synced_at = NOW()
           WHERE id = $1`,
          [row.id, lead.utm_source ?? 'organico', lead.utm_medium ?? null, lead.utm_campaign ?? lead.quiz_slug ?? null],
        );
        updated++;
      }
    } finally {
      await crm.end();
    }
    return { checked: pending.length, updated, notFound: pending.length - updated };
  }

  // ─── Auditoria de prompts (visão do super-admin sobre todos os tenants) ──

  // Prévia curta pra listagem — não manda o texto completo do prompt.
  private preview(text: string | null | undefined, max = 150): string | null {
    if (!text?.trim()) return null;
    const trimmed = text.trim();
    return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
  }

  // Lista, por tenant, o tamanho (em caracteres) de cada prompt configurado —
  // monólito (custom_prompt_sofia/megahair), multi-agente (agents.system_prompt)
  // e módulos dinâmicos (prompt_modules). Não retorna o texto completo aqui (só
  // preview curto); pra ler tudo, usar os endpoints abaixo (monolith/:kind,
  // agent/:agentId e module/:moduleId).
  //
  // promptEngine indica qual motor está REALMENTE ativo pra esse tenant agora
  // (whatsapp_config.prompt_engine) — um tenant pode ter monólito antigo salvo
  // (fica como fallback/histórico) mas estar rodando em dynamic_modules; sem
  // esse campo a tela dava a entender que o monólito ainda estava em uso.
  @Get('prompts')
  async listPrompts() {
    const tenants = await this.whatsappConfigService.listAll();
    const result: any[] = [];
    for (const t of tenants) {
      const agents = await this.agentsService.findAll(t.id);
      const modules = t.promptEngine === 'dynamic_modules'
        ? await this.promptModuleRepo.find({ where: { tenantId: t.id }, order: { sortOrder: 'ASC' } })
        : [];
      result.push({
        tenantId: t.id,
        displayName: t.displayName ?? t.profileName,
        agentType: t.agentType,
        multiAgentEnabled: t.multiAgentEnabled,
        promptEngine: t.promptEngine ?? 'legacy',
        monolith: {
          sofia: t.customPromptSofia?.trim()
            ? { length: t.customPromptSofia.length, preview: this.preview(t.customPromptSofia) }
            : null,
          megahair: t.customPromptMegaHair?.trim()
            ? { length: t.customPromptMegaHair.length, preview: this.preview(t.customPromptMegaHair) }
            : null,
        },
        multiAgent: agents.map(a => ({
          agentId: a.id,
          name: a.name,
          isActive: a.isActive,
          length: a.systemPrompt?.length ?? 0,
        })),
        dynamicModules: modules.map(m => ({
          moduleId: m.id,
          name: m.name,
          isCore: m.isCore,
          isActive: m.isActive,
          length: m.content?.length ?? 0,
        })),
      });
    }
    return result;
  }

  // Texto completo do prompt monólito de um tenant (kind = 'sofia' | 'megahair').
  @Get('prompts/:tenantId/monolith/:kind')
  async getMonolithPrompt(@Param('tenantId') tenantId: string, @Param('kind') kind: 'sofia' | 'megahair') {
    if (kind !== 'sofia' && kind !== 'megahair') throw new BadRequestException('kind inválido — use sofia ou megahair');
    const tenant = await this.whatsappConfigService.getByTenant(tenantId);
    if (!tenant) throw new NotFoundException('Cliente não encontrado');
    const text = kind === 'sofia' ? tenant.customPromptSofia : tenant.customPromptMegaHair;
    return { text: text ?? '', length: text?.length ?? 0 };
  }

  // Texto completo do system_prompt de um agente específico do multi-agente.
  @Get('prompts/:tenantId/agent/:agentId')
  async getAgentPrompt(@Param('tenantId') tenantId: string, @Param('agentId') agentId: string) {
    const agents = await this.agentsService.findAll(tenantId);
    const agent = agents.find(a => a.id === agentId);
    if (!agent) throw new NotFoundException('Agente não encontrado');
    return { text: agent.systemPrompt ?? '', length: agent.systemPrompt?.length ?? 0 };
  }

  // Texto completo (content) de um módulo dinâmico específico.
  @Get('prompts/:tenantId/module/:moduleId')
  async getModulePrompt(@Param('tenantId') tenantId: string, @Param('moduleId') moduleId: string) {
    const module = await this.promptModuleRepo.findOne({ where: { id: moduleId, tenantId } });
    if (!module) throw new NotFoundException('Módulo não encontrado');
    return { text: module.content ?? '', length: module.content?.length ?? 0 };
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

    // Erros de envio de mídia por tenant no dia — separado da query acima porque um
    // tenant pode só ter erro (0 vídeos enviados com sucesso) e ainda assim precisa
    // aparecer aqui (ver bug real: vídeo 4K da Telma que "enviava" mas não abria).
    const errorsByTenant = await this.mediaSendErrorRepo.query(`
      SELECT
        e.tenant_id,
        COALESCE(wc.display_name, wc.profile_name, e.tenant_id::text) AS tenant_name,
        COUNT(e.id)::int AS errors_today,
        COUNT(e.id) FILTER (WHERE e.reason = 'not_found')::int   AS not_found_today,
        COUNT(e.id) FILTER (WHERE e.reason = 'send_failed')::int AS send_failed_today
      FROM media_send_errors e
      JOIN whatsapp_config wc ON e.tenant_id = wc.id
      WHERE (e.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date = $1
      GROUP BY e.tenant_id, wc.display_name, wc.profile_name
      ORDER BY errors_today DESC
    `, [day]);

    // Últimos eventos de erro do dia, pra investigação rápida (nome da mídia, lead, motivo).
    const recentErrors = await this.mediaSendErrorRepo.query(`
      SELECT
        e.id, e.tenant_id,
        COALESCE(wc.display_name, wc.profile_name, e.tenant_id::text) AS tenant_name,
        e.phone, e.media_name, e.reason, e.error_message, e.created_at
      FROM media_send_errors e
      JOIN whatsapp_config wc ON e.tenant_id = wc.id
      WHERE (e.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date = $1
      ORDER BY e.created_at DESC
      LIMIT 50
    `, [day]);

    // Junta vídeos enviados + erros por tenant num só array (um tenant pode aparecer
    // só numa das duas queries — ex: só erro, zero sucesso, ou vice-versa).
    const byTenantMap = new Map<string, any>();
    for (const t of byTenant) {
      byTenantMap.set(t.tenant_id, { ...t, errors_today: 0, not_found_today: 0, send_failed_today: 0 });
    }
    for (const e of errorsByTenant) {
      const existing = byTenantMap.get(e.tenant_id);
      if (existing) {
        existing.errors_today = e.errors_today;
        existing.not_found_today = e.not_found_today;
        existing.send_failed_today = e.send_failed_today;
      } else {
        byTenantMap.set(e.tenant_id, {
          tenant_id: e.tenant_id, tenant_name: e.tenant_name, daily_limit: null, videos_sent: 0,
          errors_today: e.errors_today, not_found_today: e.not_found_today, send_failed_today: e.send_failed_today,
        });
      }
    }
    const byTenantMerged = Array.from(byTenantMap.values()).sort((a, b) => b.errors_today - a.errors_today || b.videos_sent - a.videos_sent);

    const totalToday = byTenant.reduce((sum: number, t: any) => sum + Number(t.videos_sent), 0);
    const totalErrorsToday = errorsByTenant.reduce((sum: number, t: any) => sum + Number(t.errors_today), 0);

    return { date: day, total_today: totalToday, total_errors_today: totalErrorsToday, by_tenant: byTenantMerged, history, recent_errors: recentErrors };
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
