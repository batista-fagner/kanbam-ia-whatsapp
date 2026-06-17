import { Controller, Get, Post, Param, Patch, Delete, Body, Query, Inject, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { LeadsService } from './leads.service';
import { LeadsGateway } from './leads.gateway';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('leads')
export class LeadsController {
  constructor(
    private readonly leadsService: LeadsService,
    private readonly leadsGateway: LeadsGateway,
    private readonly configService: ConfigService,
  ) {}

  @Post()
  async createManual(
    @Body() body: { phone: string; name?: string },
    @CurrentUser('tenantId') tenantId: string,
  ) {
    const { lead, isNew } = await this.leadsService.findOrCreate(body.phone, tenantId, body.name);
    this.leadsGateway.emitLeadUpdated(lead);
    return { ...lead, isNew };
  }

  @Get()
  findAll(@CurrentUser('tenantId') tenantId: string) {
    return this.leadsService.findAll(tenantId);
  }

  @Get('deleted')
  findDeleted(@CurrentUser('tenantId') tenantId: string) {
    return this.leadsService.findDeleted(tenantId);
  }

  @Get('dashboard')
  getDashboard(@CurrentUser('tenantId') tenantId: string, @Query('period') period?: string) {
    const valid = ['7', '30', '90', 'all'];
    const p = valid.includes(period ?? '') ? period : 'all';
    return this.leadsService.getDashboard(p as any, tenantId);
  }

  @Get('deleted/:id')
  findOneDeleted(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    return this.leadsService.findOneDeleted(id, tenantId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    return this.leadsService.findOne(id, tenantId);
  }

  @Get(':id/conversation')
  getConversation(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    return this.leadsService.getConversationWithMessages(id, tenantId);
  }

  @Get(':id/history')
  getHistory(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    return this.leadsService.getHistory(id, tenantId);
  }

  @Patch(':id/stage')
  async updateStage(@Param('id') id: string, @Body() body: { stage: string }, @CurrentUser('tenantId') tenantId: string) {
    const lead = await this.leadsService.updateStage(id, body.stage as any, 'operator', tenantId);
    this.leadsGateway.emitLeadUpdated(lead);
    return lead;
  }

  @Patch(':id/name')
  async updateName(@Param('id') id: string, @Body() body: { name: string }, @CurrentUser('tenantId') tenantId: string) {
    const lead = await this.leadsService.updateName(id, body.name, tenantId);
    this.leadsGateway.emitLeadUpdated(lead);
    return lead;
  }

  @Patch(':id/ai')
  async toggleAi(@Param('id') id: string, @Body() body: { enabled: boolean }, @CurrentUser('tenantId') tenantId: string) {
    await this.leadsService.toggleAi(id, body.enabled, tenantId);
    return { ok: true };
  }

  @Patch(':id/observations')
  async updateObservations(@Param('id') id: string, @Body() body: { observations: string }, @CurrentUser('tenantId') tenantId: string) {
    const lead = await this.leadsService.update(id, { observations: body.observations } as any, tenantId);
    this.leadsGateway.emitLeadUpdated(lead);
    return lead;
  }

  @Delete(':id')
  async deleteLead(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string, @Body() body: { reason?: string } = {}) {
    await this.leadsService.deleteLead(id, body.reason ?? '', tenantId);
    this.leadsGateway.emitLeadDeleted(id, tenantId);
    return { ok: true };
  }

  @Delete(':id/labels/:label')
  async removeLabel(@Param('id') id: string, @Param('label') label: string, @CurrentUser('tenantId') tenantId: string) {
    const lead = await this.leadsService.findOne(id, tenantId);
    if (!lead) return { ok: false };

    // Remove do banco
    const updatedLabels = (lead.labels ?? []).filter((l) => l !== label);
    await this.leadsService.update(id, { labels: updatedLabels } as any, tenantId);

    // Remove da uazapi
    const uazapiUrl = this.configService.get('UAZAPI_BASE_URL') || 'https://labsai.uazapi.com';
    const uazapiToken = this.configService.get('UAZAPI_TOKEN');

    if (uazapiToken) {
      try {
        // Busca ID da etiqueta pelo nome
        const labelsRes = await axios.get(`${uazapiUrl}/labels`, {
          headers: { token: uazapiToken, Accept: 'application/json' },
        });
        const found = (labelsRes.data || []).find((l: any) => l.name.toLowerCase() === label.toLowerCase());
        if (found) {
          await axios.post(
            `${uazapiUrl}/chat/labels`,
            { number: lead.phone, remove_labelid: found.id },
            { headers: { token: uazapiToken, 'Content-Type': 'application/json' } },
          );
        }
      } catch {
        // Falha silenciosa — etiqueta já foi removida do banco
      }
    }

    const updatedLead = await this.leadsService.findOne(id, tenantId);
    this.leadsGateway.emitLeadUpdated(updatedLead);
    return updatedLead;
  }
}
