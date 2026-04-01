import { Controller, Get, Param, Patch, Delete, Body } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { LeadsGateway } from './leads.gateway';

@Controller('leads')
export class LeadsController {
  constructor(
    private readonly leadsService: LeadsService,
    private readonly leadsGateway: LeadsGateway,
  ) {}

  @Get()
  findAll() {
    return this.leadsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.leadsService.findOne(id);
  }

  @Get(':id/conversation')
  getConversation(@Param('id') id: string) {
    return this.leadsService.getConversationWithMessages(id);
  }

  @Get(':id/history')
  getHistory(@Param('id') id: string) {
    return this.leadsService.getHistory(id);
  }

  @Patch(':id/stage')
  async updateStage(@Param('id') id: string, @Body() body: { stage: string }) {
    const lead = await this.leadsService.updateStage(id, body.stage as any, 'operator');
    this.leadsGateway.emitLeadUpdated(lead);
    return lead;
  }

  @Patch(':id/ai')
  async toggleAi(@Param('id') id: string, @Body() body: { enabled: boolean }) {
    await this.leadsService.toggleAi(id, body.enabled);
    return { ok: true };
  }

  @Delete(':id')
  async deleteLead(@Param('id') id: string) {
    await this.leadsService.deleteLead(id);
    this.leadsGateway.emitLeadDeleted(id);
    return { ok: true };
  }
}
