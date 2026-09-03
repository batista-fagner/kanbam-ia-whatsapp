import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
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

// Admin gerencia módulos de QUALQUER tenant (mesmo endpoint/service acima, mas
// com tenantId vindo da URL em vez do JWT) — usado pelo AdminPromptsPage pra
// editar módulos dinâmicos sem precisar logar como o cliente.
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/prompt-modules/:tenantId')
export class AdminPromptModulesController {
  constructor(private readonly service: PromptModulesService) {}

  @Get()
  findAll(@Param('tenantId') tenantId: string) {
    return this.service.findAll(tenantId);
  }

  @Post()
  create(@Param('tenantId') tenantId: string, @Body() body: any) {
    return this.service.create(tenantId, body);
  }

  @Patch(':id')
  update(@Param('tenantId') tenantId: string, @Param('id') id: string, @Body() body: any) {
    return this.service.update(tenantId, id, body);
  }

  @Delete(':id')
  remove(@Param('tenantId') tenantId: string, @Param('id') id: string) {
    return this.service.remove(tenantId, id);
  }
}
