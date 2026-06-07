import { Controller, Get, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { FollowupService } from './followup.service';

@UseGuards(JwtAuthGuard)
@Controller('followups')
export class FollowupController {
  constructor(private readonly followupService: FollowupService) {}

  // Sugere uma mensagem de follow-up com a IA (operador revisa antes de agendar)
  @Post('generate')
  generate(@Body() body: { leadId: string }, @CurrentUser('tenantId') tenantId: string) {
    return this.followupService.generateSuggestion(body.leadId, tenantId);
  }

  // Agenda o envio (delayHours: 1 | 4 | 24)
  @Post()
  schedule(
    @Body() body: { leadId: string; message: string; delayHours: number },
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.followupService.schedule(body.leadId, tenantId, body.message, body.delayHours);
  }

  // Lista pendentes de um lead
  @Get('lead/:leadId')
  listForLead(@Param('leadId') leadId: string, @CurrentUser('tenantId') tenantId: string) {
    return this.followupService.listForLead(leadId, tenantId);
  }

  // Cancela um follow-up pendente
  @Delete(':id')
  cancel(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    return this.followupService.cancel(id, tenantId);
  }
}
