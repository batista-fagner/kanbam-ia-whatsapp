import { Controller, Post, Get, Delete, Body, Patch, UseGuards } from '@nestjs/common';
import { UazapiProvider } from './providers/uazapi.provider';
import { WhatsappConfigService } from './whatsapp-config.service';
import { AiService } from '../ai/ai.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('instance')
export class InstanceController {
  constructor(
    private readonly uazapi: UazapiProvider,
    private readonly whatsappConfigService: WhatsappConfigService,
    private readonly aiService: AiService,
  ) {}

  @Post('connect')
  async connect(@Body() body: { phone?: string }, @CurrentUser('tenantId') tenantId: string) {
    const token = await this.whatsappConfigService.getTokenByTenant(tenantId);
    return this.uazapi.connectInstance(body.phone, token);
  }

  @Get('status')
  async status(@CurrentUser('tenantId') tenantId: string) {
    const token = await this.whatsappConfigService.getTokenByTenant(tenantId);
    return this.uazapi.getInstanceStatus(token);
  }

  @Post('disconnect')
  async disconnect(@CurrentUser('tenantId') tenantId: string) {
    const token = await this.whatsappConfigService.getTokenByTenant(tenantId);
    return this.uazapi.disconnectInstance(token);
  }

  @Post('reset')
  async reset(@CurrentUser('tenantId') tenantId: string) {
    const token = await this.whatsappConfigService.getTokenByTenant(tenantId);
    return this.uazapi.resetInstance(token);
  }

  // Cria a instância uazapi PARA o tenant logado (salva token na linha dele + webhook /uazapi/{tenantId}).
  // Usado na implementação assistida quando o cliente ainda não tem instância.
  @Post()
  async createInstance(@Body() body: { name?: string }, @CurrentUser('tenantId') tenantId: string) {
    const name = body?.name?.trim() || `instance-${tenantId.slice(0, 8)}`;
    return this.whatsappConfigService.createNewInstance(name, undefined, undefined, tenantId);
  }

  @Delete()
  async delete(@CurrentUser('tenantId') tenantId: string) {
    const token = await this.whatsappConfigService.getTokenByTenant(tenantId);
    let result: any = { response: 'Instance Deleted' };
    try {
      result = await this.uazapi.deleteInstance(token);
    } catch {
      // instância pode já ter sido removida da uazapi — limpa o banco de qualquer forma
    }
    await this.whatsappConfigService.deleteRecord(tenantId);
    return result;
  }

  @Post('setup-webhook')
  async setupWebhook(@CurrentUser('tenantId') tenantId: string) {
    return this.whatsappConfigService.setupAfterConnect(tenantId);
  }

  @Get('config')
  async getConfig(@CurrentUser('tenantId') tenantId: string) {
    return this.whatsappConfigService.getByTenant(tenantId);
  }

  @Patch('config')
  async updateConfig(
    @Body() body: {
      customPromptMegaHair?: string | null;
      autoFollowupConfig?: Record<string, { enabled?: boolean; idleMinutes?: number; message?: string }> | null;
    },
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.whatsappConfigService.updateConfig(body, tenantId);
  }

  @Get('default-prompts')
  async getDefaultPrompts() {
    return {
      megahair: this.aiService.getDefaultPromptMegaHair(),
    };
  }
}
