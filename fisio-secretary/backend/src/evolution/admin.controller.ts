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

  // Remove um cliente (tenant + usuários). Recusa se houver leads cadastrados.
  @Delete('clients/:id')
  async deleteClient(@Param('id') id: string) {
    const leadsCount = await this.leadsService.countByTenant(id);
    if (leadsCount > 0) throw new BadRequestException(`Cliente tem ${leadsCount} leads — remova os leads antes ou suspenda ao invés de deletar.`);
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
        tu.date,
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
