import { Controller, Post, Get, Body, Param, BadRequestException, NotFoundException, UseGuards } from '@nestjs/common';
import { BulkMessageService } from './bulk-message.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('bulk-message')
export class BulkMessageController {
  constructor(private readonly bulkMessageService: BulkMessageService) {}

  @Post()
  async send(
    @Body()
    body: {
      mode: 'manual' | 'system';
      numbers?: string[];
      leadIds?: string[];
      message: string;
      campaignName?: string;
      delayMin?: number;
      delayMax?: number;
    },
    @CurrentUser('tenantId') tenantId: string,
  ) {
    if (!body.message?.trim()) {
      throw new BadRequestException('Mensagem não pode ser vazia');
    }
    if (body.mode === 'manual' && !body.numbers?.length) {
      throw new BadRequestException('Nenhum número fornecido');
    }
    if (body.mode === 'system' && !body.leadIds?.length) {
      throw new BadRequestException('Nenhum lead selecionado');
    }
    return this.bulkMessageService.sendBulk(body, tenantId);
  }

  @Get('campaigns')
  async listCampaigns(@CurrentUser('tenantId') tenantId: string) {
    return this.bulkMessageService.getCampaigns(tenantId);
  }

  @Get('campaigns/:id')
  async getCampaign(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    const campaign = await this.bulkMessageService.getCampaignById(id, tenantId);
    if (!campaign) throw new NotFoundException('Campanha não encontrada');
    return campaign;
  }

  @Get('campaigns/:id/messages')
  async getCampaignMessages(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    const campaign = await this.bulkMessageService.getCampaignById(id, tenantId);
    if (!campaign) throw new NotFoundException('Campanha não encontrada');
    if (!campaign.folderId) return { messages: [], note: 'folder_id não disponível para esta campanha' };
    return this.bulkMessageService.getCampaignMessages(campaign.folderId, tenantId);
  }

  @Post('campaigns/:id/action')
  async controlCampaign(
    @Param('id') id: string,
    @Body() body: { action: 'stop' | 'continue' | 'delete' },
    @CurrentUser('tenantId') tenantId: string,
  ) {
    if (!['stop', 'continue', 'delete'].includes(body.action)) {
      throw new BadRequestException('Ação inválida. Use: stop, continue ou delete');
    }
    const campaign = await this.bulkMessageService.getCampaignById(id, tenantId);
    if (!campaign) throw new NotFoundException('Campanha não encontrada');
    if (!campaign.folderId) throw new BadRequestException('Campanha sem folder_id — controle não disponível');
    return this.bulkMessageService.controlCampaign(campaign.folderId, body.action, tenantId);
  }
}
