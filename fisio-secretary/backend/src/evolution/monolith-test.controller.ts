import { Controller, Post, Body, UseGuards, BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AiService } from '../ai/ai.service';
import { WhatsappConfigService } from './whatsapp-config.service';
import { MediaService } from '../media/media.service';
import { Lead } from '../common/entities/lead.entity';

// Contas autorizadas a testar o monólito (contador de token, sem WhatsApp) — mesmo
// rollout gated do multi-agente. Ver MULTI_AGENT_BETA_EMAILS no frontend.
const ALLOWED_EMAILS = ['bfagner@hotmail.com.br', 'claudia_teste@hotmail.com', 'alex_teste@hotmail.com', 'alexcosta171@yahoo.com'];

// Simulação de conversa com o fluxo monólito (processMessageMegaHair), sem persistir
// Lead nem passar pelo WhatsApp — só pra medir consumo de token em tempo real.
@UseGuards(JwtAuthGuard)
@Controller('monolith-test')
export class MonolithTestController {
  constructor(
    private readonly aiService: AiService,
    private readonly whatsappConfigService: WhatsappConfigService,
    private readonly mediaService: MediaService,
    private readonly config: ConfigService,
  ) {}

  @Post('chat')
  async chat(
    @Body() body: { message: string; aiContext?: any[] },
    @CurrentUser() user: { tenantId: string; email: string },
  ) {
    // Ambiente local (DATABASE_SSL=false no .env.development) libera qualquer conta —
    // mesma regra do canSeeMultiAgent/canSeeMonolithTest no frontend.
    const isLocalDev = this.config.get('DATABASE_SSL') === 'false';
    if (!isLocalDev && !ALLOWED_EMAILS.includes(user.email)) {
      throw new ForbiddenException('Teste do monólito disponível apenas para esta conta.');
    }
    if (!body?.message?.trim()) throw new BadRequestException('Mensagem é obrigatória');

    const config = await this.whatsappConfigService.getByTenant(user.tenantId);
    const mediaFiles = await this.mediaService.listAll(user.tenantId);
    const availableMediaNames = mediaFiles.map((m) => m.name);

    const aiContext = body.aiContext ?? [];
    const facts = this.extractAccumulatedFields(aiContext);
    const fakeLead = {
      id: 'monolith-test-session',
      tenantId: user.tenantId,
      aiContext,
      ...facts,
    } as Lead;

    const result = await this.aiService.processMessageMegaHair(
      fakeLead,
      body.message,
      availableMediaNames,
      config?.customPromptMegaHair ?? undefined,
    );

    const updatedContext = this.aiService.buildUpdatedContext(fakeLead, body.message, result.rawJson!);

    return {
      reply: result.reply,
      stage: result.stage,
      temperature: result.temperature,
      action: result.action,
      mediaName: result.mediaName,
      tags: result.tags,
      aiContext: updatedContext,
      tokenUsage: result.tokenUsage,
    };
  }

  // Mesma lógica do AgentsService.extractAccumulatedFields — no teste sandbox não
  // persistimos Lead, então reconstruímos os fatos a partir do aiContext ida-e-volta.
  private extractAccumulatedFields(aiContext: any[]) {
    const acc: { name?: string; symptoms?: string; urgency?: string; availability?: string; budget?: string } = {};
    for (const m of aiContext) {
      if (m?.role !== 'assistant' || typeof m.content !== 'string') continue;
      try {
        const f = JSON.parse(m.content)?.fields;
        if (!f) continue;
        if (f.name && f.name !== 'null') acc.name = f.name;
        if (f.symptoms) acc.symptoms = f.symptoms;
        if (f.urgency) acc.urgency = f.urgency;
        if (f.availability) acc.availability = f.availability;
        if (f.budget) acc.budget = f.budget;
      } catch { /* turno sem JSON válido, ignora */ }
    }
    return acc;
  }
}
