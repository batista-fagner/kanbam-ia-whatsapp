import { Controller, Get, Param, Patch, Body } from '@nestjs/common';
import { LeadsService } from './leads.service';

@Controller('leads')
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

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

  @Patch(':id/stage')
  updateStage(@Param('id') id: string, @Body() body: { stage: string }) {
    return this.leadsService.updateStage(id, body.stage as any, 'operator');
  }
}
