import { Controller, Get, Param, Query, Delete, Patch, Body } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { FacebookService } from '../facebook/facebook.service';

@Controller('leads')
export class LeadsController {
  constructor(
    private leadsService: LeadsService,
    private facebookService: FacebookService,
  ) {}

  @Get()
  async findAll(@Query('campaignId') campaignId?: string) {
    return this.leadsService.findAll(campaignId);
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.leadsService.findById(id);
  }

  @Patch(':id/convert')
  async convert(@Param('id') id: string, @Body() body: { value?: number }) {
    const lead = await this.leadsService.markAsConverted(id);
    this.facebookService.sendPurchaseEvent(lead, body.value ?? 3000).catch(() => null);
    return lead;
  }

  @Delete('__clear-all__')
  async clearAll() {
    return this.leadsService.clearAll();
  }
}
