import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AdminGuard } from '../../auth/admin.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AgendaIntegration } from '../../common/entities/agenda-integration.entity';
import { TenantSchedule } from '../../common/entities/tenant-schedule.entity';
import { TrinksIntegrationService } from './trinks-integration.service';

// Conta da cliente: ver a conexão, ligar/aprovar os serviços e ver o histórico da IA.
// A chave da API nunca aparece aqui (nem mascarada) — só o admin cadastra.
@UseGuards(JwtAuthGuard)
@Controller('agenda/trinks')
export class TrinksController {
  constructor(private readonly trinks: TrinksIntegrationService) {}

  @Get()
  async status(@CurrentUser('tenantId') tenantId: string) {
    return this.trinks.status(tenantId);
  }

  @Get('services')
  async services(@CurrentUser('tenantId') tenantId: string) {
    const integ = await this.trinks.getIntegration(tenantId);
    return { links: await this.trinks.listServiceLinks(tenantId), catalog: this.trinks.catalogServices(integ) };
  }

  @Post('sync')
  async sync(@CurrentUser('tenantId') tenantId: string) {
    try {
      await this.trinks.syncCatalog(tenantId, true);
    } catch (err) {
      await this.trinks.recordError(tenantId, err);
      throw new BadRequestException(`Não deu pra atualizar da Trinks: ${(err as Error).message}`);
    }
    return this.trinks.status(tenantId);
  }

  @Put('services/:id/link')
  async link(@Param('id') id: string, @Body() body: { externalId?: string | number | null }, @CurrentUser('tenantId') tenantId: string) {
    await this.trinks.linkService(tenantId, id, body?.externalId ?? null);
    return { ok: true };
  }

  @Post('services/:id/approve')
  async approve(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string, @CurrentUser('email') email: string) {
    await this.trinks.approveService(tenantId, id, email ?? null);
    return { ok: true };
  }

  @Post('services/:id/unapprove')
  async unapprove(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    await this.trinks.unapproveService(tenantId, id);
    return { ok: true };
  }

  @Put('auto-confirm')
  async autoConfirm(@Body() body: { value?: boolean }, @CurrentUser('tenantId') tenantId: string) {
    await this.trinks.setAutoConfirm(tenantId, !!body?.value);
    return { ok: true };
  }

  @Get('log')
  log(@Query('limit') limit: string, @CurrentUser('tenantId') tenantId: string) {
    return this.trinks.aiLog(tenantId, limit ? parseInt(limit, 10) || 100 : 100);
  }
}

// Admin: cadastrar/testar/remover a chave e trocar o modo da agenda do cliente para 'trinks'.
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/agenda')
export class TrinksAdminController {
  constructor(
    private readonly trinks: TrinksIntegrationService,
    @InjectRepository(AgendaIntegration) private readonly repo: Repository<AgendaIntegration>,
    @InjectRepository(TenantSchedule) private readonly scheduleRepo: Repository<TenantSchedule>,
  ) {}

  // { [tenantId]: { establishmentName, mode } } — só quem tem a Trinks conectada.
  @Get('trinks')
  async connected() {
    const rows = await this.repo.find();
    const schedules = rows.length ? await this.scheduleRepo.find({ where: { tenantId: In(rows.map((r) => r.tenantId)) } }) : [];
    return Object.fromEntries(rows.map((r) => [r.tenantId, { establishmentName: r.establishmentName, mode: schedules.find((s) => s.tenantId === r.tenantId)?.mode ?? 'simple' }]));
  }

  @Get(':tenantId/trinks')
  status(@Param('tenantId') tenantId: string) {
    return this.trinks.status(tenantId);
  }

  @Put(':tenantId/trinks')
  connect(@Param('tenantId') tenantId: string, @Body() body: { apiKey?: string }) {
    return this.trinks.connect(tenantId, body?.apiKey ?? '');
  }

  @Post(':tenantId/trinks/test')
  test(@Param('tenantId') tenantId: string) {
    return this.trinks.testConnection(tenantId);
  }

  @Delete(':tenantId/trinks')
  async disconnect(@Param('tenantId') tenantId: string) {
    await this.trinks.disconnect(tenantId);
    return { ok: true };
  }

  // Liga/desliga a agenda da Trinks para o cliente. Desligar volta para a agenda do CRM.
  @Put(':tenantId/trinks/mode')
  async setMode(@Param('tenantId') tenantId: string, @Body() body: { on?: boolean }) {
    const st = await this.trinks.status(tenantId);
    if (body?.on && !st.connected) throw new BadRequestException('Conecte a Trinks antes de ligar');
    let schedule = await this.scheduleRepo.findOne({ where: { tenantId } });
    if (!schedule) schedule = this.scheduleRepo.create({ tenantId, enabled: false, slotMinutes: 30, capacity: 1, bookingWindowDays: 14, minNoticeHours: 2, weeklyHours: {} });
    schedule.mode = body?.on ? 'trinks' : 'professionals';
    await this.scheduleRepo.save(schedule);
    return this.trinks.status(tenantId);
  }
}
