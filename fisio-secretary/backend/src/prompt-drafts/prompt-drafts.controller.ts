import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { PromptDraftsService } from './prompt-drafts.service';

// Fase 1 do agente de CS (ver agente-suporte-cs.md) — gera/revisa rascunhos de prompt a
// partir do formulário de onboarding. Só o super-admin (dono da plataforma) usa esta tela.
@Controller('admin/prompt-drafts')
@UseGuards(JwtAuthGuard, AdminGuard)
export class PromptDraftsController {
  constructor(private readonly service: PromptDraftsService) {}

  @Get('forms')
  listForms() {
    return this.service.listOnboardingForms();
  }

  @Get()
  list(@Query('status') status?: string) {
    return this.service.listDrafts(status);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.getDraft(id);
  }

  @Post('generate/:tenantId')
  generate(@Param('tenantId') tenantId: string, @Body('referenceTenantId') referenceTenantId?: string) {
    return this.service.generateDraft(tenantId, referenceTenantId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body('content') content: string) {
    return this.service.updateDraftContent(id, content);
  }

  @Post(':id/approve')
  approve(@Param('id') id: string, @Body('content') content?: string) {
    return this.service.approveDraft(id, content);
  }

  @Post(':id/discard')
  discard(@Param('id') id: string) {
    return this.service.discardDraft(id);
  }
}
