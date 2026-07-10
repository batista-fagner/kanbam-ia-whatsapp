import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { PromptModulesService } from './prompt-modules.service';

@UseGuards(JwtAuthGuard)
@Controller('prompt-modules')
export class PromptModulesController {
  constructor(private readonly service: PromptModulesService) {}

  @Get()
  findAll(@CurrentUser('tenantId') tenantId: string) {
    return this.service.findAll(tenantId);
  }

  @Post()
  create(@Body() body: any, @CurrentUser('tenantId') tenantId: string) {
    return this.service.create(tenantId, body);
  }

  @Post('chat')
  chat(
    @Body() body: { message: string; previousModuleNames?: string[]; aiContext?: any[]; model?: string },
    @CurrentUser('tenantId') tenantId: string,
  ) {
    return this.service.chatTest(tenantId, body?.message, body?.previousModuleNames ?? [], body?.aiContext ?? [], body?.model || undefined);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any, @CurrentUser('tenantId') tenantId: string) {
    return this.service.update(tenantId, id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    return this.service.remove(tenantId, id);
  }
}
