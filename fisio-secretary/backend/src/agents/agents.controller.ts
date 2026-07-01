import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AgentsService } from './agents.service';

@UseGuards(JwtAuthGuard)
@Controller('agents')
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Get()
  findAll(@CurrentUser('tenantId') tenantId: string) {
    return this.agentsService.findAll(tenantId);
  }

  @Post()
  create(@Body() body: any, @CurrentUser('tenantId') tenantId: string) {
    return this.agentsService.create(tenantId, body);
  }

  @Post('test')
  test(@Body() body: { message: string }, @CurrentUser('tenantId') tenantId: string) {
    return this.agentsService.testRouting(tenantId, body?.message);
  }

  @Post('chat')
  chat(
    @Body() body: { message: string; currentAgentId?: string | null },
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.agentsService.chat(tenantId, body?.message, body?.currentAgentId ?? null);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any, @CurrentUser('tenantId') tenantId: string) {
    return this.agentsService.update(tenantId, id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    return this.agentsService.remove(tenantId, id);
  }
}
