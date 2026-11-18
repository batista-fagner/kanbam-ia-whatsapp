import { Body, Controller, Delete, Get, Headers, HttpCode, Logger, Param, Post, Put, Query, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { InstagramService } from './instagram.service';

// Webhook do Instagram, REPASSADO pelo convertHairCRM. O app CRM-IA da Meta tem um webhook
// só, que aponta para o convertHairCRM; lá, os eventos de contas que não são a converthair
// vêm para cá com o cabeçalho x-forward-secret (mesmo valor de IG_FORWARD_SECRET nos dois
// serviços). Sem o segredo configurado, tudo é recusado.
@Controller('webhooks/instagram')
export class InstagramWebhookController {
  private readonly logger = new Logger(InstagramWebhookController.name);

  constructor(private readonly service: InstagramService, private readonly config: ConfigService) {}

  @Post()
  @HttpCode(200)
  receive(@Body() body: any, @Headers('x-forward-secret') secret?: string) {
    const expected = this.config.get<string>('IG_FORWARD_SECRET') ?? '';
    if (!expected || !secret || !this.same(secret, expected)) {
      this.logger.warn('[IG] Webhook recusado: x-forward-secret ausente ou errado');
      throw new UnauthorizedException();
    }
    // Responde na hora; o processamento (chamadas à Meta) segue em segundo plano.
    this.service.handleWebhook(body).catch((err) => this.logger.error(`[IG] ${err.message}`));
    return { ok: true };
  }

  private same(a: string, b: string): boolean {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
  }
}

// Tela "Instagram" da cliente. O token nunca aparece aqui.
@UseGuards(JwtAuthGuard)
@Controller('instagram')
export class InstagramController {
  constructor(private readonly service: InstagramService) {}

  @Get()
  status(@CurrentUser('tenantId') tenantId: string) {
    return this.service.status(tenantId);
  }

  @Put('settings')
  settings(@CurrentUser('tenantId') tenantId: string, @Body() body: any) {
    return this.service.updateSettings(tenantId, body ?? {});
  }

  @Get('media')
  media(@CurrentUser('tenantId') tenantId: string, @Query('after') after?: string) {
    return this.service.listMedia(tenantId, after);
  }

  @Get('automations')
  automations(@CurrentUser('tenantId') tenantId: string) {
    return this.service.listAutomations(tenantId);
  }

  @Post('automations')
  create(@CurrentUser('tenantId') tenantId: string, @Body() body: any) {
    return this.service.saveAutomation(tenantId, body ?? {});
  }

  @Put('automations/:id')
  update(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string, @Body() body: any) {
    return this.service.saveAutomation(tenantId, body ?? {}, id);
  }

  @Delete('automations/:id')
  remove(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.service.deleteAutomation(tenantId, id);
  }

  @Get('events')
  events(@CurrentUser('tenantId') tenantId: string, @Query('limit') limit?: string) {
    return this.service.listEvents(tenantId, limit ? parseInt(limit, 10) : 50);
  }
}

// Card do Admin (ClientDrawer): conectar a conta colando o token gerado no app CRM-IA.
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/instagram')
export class InstagramAdminController {
  constructor(private readonly service: InstagramService) {}

  @Get(':tenantId')
  status(@Param('tenantId') tenantId: string) {
    return this.service.adminStatus(tenantId);
  }

  @Put(':tenantId')
  connect(@Param('tenantId') tenantId: string, @Body() body: { token?: string }) {
    return this.service.connect(tenantId, body?.token ?? '');
  }

  @Post(':tenantId/test')
  test(@Param('tenantId') tenantId: string) {
    return this.service.test(tenantId);
  }

  @Delete(':tenantId')
  disconnect(@Param('tenantId') tenantId: string) {
    return this.service.disconnect(tenantId);
  }
}
