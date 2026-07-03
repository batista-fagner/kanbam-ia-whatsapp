import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Agent } from '../common/entities/agent.entity';
import { AiService, AiResponse } from '../ai/ai.service';
import { Lead } from '../common/entities/lead.entity';
import { MediaService } from '../media/media.service';

type AgentInput = Partial<Pick<Agent,
  'name' | 'description' | 'respondsTo' | 'handoffWhen' | 'systemPrompt' | 'isActive' | 'isDefault' | 'sortOrder'
  | 'canSchedule' | 'canSendMedia'>>;

@Injectable()
export class AgentsService {
  constructor(
    @InjectRepository(Agent) private readonly repo: Repository<Agent>,
    private readonly aiService: AiService,
    private readonly mediaService: MediaService,
  ) {}

  findAll(tenantId: string) {
    return this.repo.find({ where: { tenantId }, order: { sortOrder: 'ASC', createdAt: 'ASC' } });
  }

  async create(tenantId: string, body: AgentInput) {
    if (!body?.name?.trim()) throw new BadRequestException('Nome é obrigatório');
    // Só um agente de entrada por tenant.
    if (body.isDefault) await this.clearDefault(tenantId);
    const agent = this.repo.create({
      tenantId,
      name: body.name.trim(),
      description: (body.description ?? '').trim(),
      respondsTo: body.respondsTo ?? '',
      handoffWhen: body.handoffWhen ?? '',
      systemPrompt: body.systemPrompt ?? '',
      isActive: body.isActive ?? false,
      isDefault: body.isDefault ?? false,
      sortOrder: body.sortOrder ?? 0,
      canSchedule: body.canSchedule ?? true,
      canSendMedia: body.canSendMedia ?? true,
    });
    return this.repo.save(agent);
  }

  async update(tenantId: string, id: string, body: AgentInput) {
    const agent = await this.repo.findOne({ where: { id, tenantId } });
    if (!agent) throw new NotFoundException('Agente não encontrado');
    if (body.isDefault === true && !agent.isDefault) await this.clearDefault(tenantId);
    if (body.name !== undefined) agent.name = body.name.trim();
    if (body.description !== undefined) agent.description = body.description.trim();
    if (body.respondsTo !== undefined) agent.respondsTo = body.respondsTo;
    if (body.handoffWhen !== undefined) agent.handoffWhen = body.handoffWhen;
    if (body.systemPrompt !== undefined) agent.systemPrompt = body.systemPrompt;
    if (body.isActive !== undefined) agent.isActive = body.isActive;
    if (body.isDefault !== undefined) agent.isDefault = body.isDefault;
    if (body.sortOrder !== undefined) agent.sortOrder = body.sortOrder;
    if (body.canSchedule !== undefined) agent.canSchedule = body.canSchedule;
    if (body.canSendMedia !== undefined) agent.canSendMedia = body.canSendMedia;
    return this.repo.save(agent);
  }

  async remove(tenantId: string, id: string) {
    const agent = await this.repo.findOne({ where: { id, tenantId } });
    if (!agent) throw new NotFoundException('Agente não encontrado');
    await this.repo.remove(agent);
    return { ok: true };
  }

  // Simula o roteamento inicial (primeira mensagem da conversa).
  async testRouting(tenantId: string, message: string) {
    if (!message?.trim()) throw new BadRequestException('Mensagem é obrigatória');
    const active = await this.repo.find({
      where: { tenantId, isActive: true },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    if (!active.length) throw new BadRequestException('Conecte ao menos um agente ao supervisor');
    const roster = active.map((a) => ({ id: a.id, name: a.name, description: a.description, respondsTo: a.respondsTo }));
    const { agentId } = await this.aiService.routeToAgent(message, roster);
    const chosen = active.find((a) => a.id === agentId) ?? active[0];
    return { agentId: chosen.id, agentName: chosen.name };
  }

  // Simulação de teste (tela "Agentes", sem WhatsApp): usa o MESMO caminho de
  // produção (chatForLead → processMessageAgent, com histórico e capacidades
  // canSchedule/canSendMedia) — sem persistir Lead no banco. O estado da conversa
  // (aiContext) roda de ida e volta com o frontend a cada turno.
  async chatTest(tenantId: string, message: string, currentAgentId: string | null, aiContext: any[]) {
    if (!message?.trim()) throw new BadRequestException('Mensagem é obrigatória');

    const mediaFiles = await this.mediaService.listAll(tenantId);
    const availableMediaNames = mediaFiles.map((m) => m.name);

    const fakeLead = {
      id: 'test-session',
      tenantId,
      currentAgentId: currentAgentId ?? null,
      aiContext: aiContext ?? [],
    } as Lead;

    const result = await this.chatForLead(tenantId, fakeLead, message, availableMediaNames);
    if (!result) throw new BadRequestException('Conecte ao menos um agente ao supervisor');

    const updatedContext = this.aiService.buildUpdatedContext(fakeLead, message, result.aiResponse.rawJson!);

    return {
      reply: result.aiResponse.reply,
      agentId: result.agentId,
      agentName: result.agentName,
      handoffOccurred: result.handoffOccurred,
      transferredFrom: result.transferredFrom,
      stage: result.aiResponse.stage,
      temperature: result.aiResponse.temperature,
      action: result.aiResponse.action,
      mediaName: result.aiResponse.mediaName,
      tags: result.aiResponse.tags,
      aiContext: updatedContext,
    };
  }

  // ───────────────── Fluxo de PRODUÇÃO (webhook WhatsApp) ─────────────────
  // O agente atual do lead responde com o contrato JSON completo (stage/action/
  // mídia/tags) e o histórico da conversa. Se sinalizar handoff, o supervisor
  // roteia pra outro agente, que gera a resposta final. Máx. 1 handoff por
  // mensagem (anti ping-pong). Retorna null se o tenant não tem agentes ativos
  // (caller decide o fallback — fluxo single-prompt).
  async chatForLead(
    tenantId: string,
    lead: Lead,
    message: string,
    availableMediaNames: string[],
    extraSystemContext?: string,
  ): Promise<{ aiResponse: AiResponse; agentId: string; agentName: string; handoffOccurred: boolean; transferredFrom: string | null } | null> {
    const active = await this.repo.find({
      where: { tenantId, isActive: true },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    if (!active.length) return null;

    const roster = active.map((a) => ({ id: a.id, name: a.name, description: a.description, respondsTo: a.respondsTo }));
    const conversationTail = this.buildConversationTail(lead);

    // Agente atual: o persistido no lead → o default → roteado pelo supervisor.
    let current = active.find((a) => a.id === lead.currentAgentId)
      ?? active.find((a) => a.isDefault)
      ?? null;
    if (!current) {
      const { agentId } = await this.aiService.routeToAgent(message, roster, { tenantId, conversationTail });
      current = active.find((a) => a.id === agentId) ?? active[0];
    }

    let response = await this.aiService.processMessageAgent(lead, message, current, availableMediaNames, extraSystemContext);
    if (!response.handoff || active.length === 1) {
      this.ensureReply(response);
      return { aiResponse: response, agentId: current.id, agentName: current.name, handoffOccurred: false, transferredFrom: null };
    }

    // Handoff: supervisor roteia entre os DEMAIS agentes; o escolhido gera a resposta final.
    const remaining = roster.filter((a) => a.id !== current.id);
    const { agentId: newId } = await this.aiService.routeToAgent(message, remaining, { tenantId, conversationTail });
    const next = active.find((a) => a.id === newId) ?? active.find((a) => a.id !== current.id) ?? current;

    // Avisa o novo agente que o bastão já foi passado — evita handoff em cadeia (ping-pong).
    const noHandoffNote = `${extraSystemContext ? `${extraSystemContext}\n\n` : ''}NOTA DO SISTEMA: o supervisor transferiu esta conversa pra vc. Responda da melhor forma possível dentro do seu conhecimento — NÃO retorne "handoff": true nesta rodada.`;
    response = await this.aiService.processMessageAgent(lead, message, next, availableMediaNames, noHandoffNote);
    response.handoff = false;
    this.ensureReply(response);
    return { aiResponse: response, agentId: next.id, agentName: next.name, handoffOccurred: true, transferredFrom: current.name };
  }

  // Garantia: nunca devolver reply vazio pro cliente (handoff deixa reply="").
  private ensureReply(response: AiResponse): void {
    if (!response.reply?.trim() && response.action !== 'send_media') {
      response.reply = 'Oi! Me conta um pouquinho mais o que vc precisa? 😊';
    }
  }

  // Últimas trocas da conversa em texto puro — contexto pro supervisor rotear certo
  // mesmo quando a mensagem atual é curta ("sim", "quanto?").
  private buildConversationTail(lead: Lead): string | undefined {
    const history = (lead.aiContext as any[]) ?? [];
    if (!history.length) return undefined;
    return history.slice(-6).map((m) => {
      let content = typeof m.content === 'string' ? m.content : '';
      if (m.role === 'assistant') {
        // Histórico do assistant guarda o JSON bruto — extrai só o reply.
        try { content = JSON.parse(content)?.reply ?? content; } catch { /* texto puro */ }
      }
      return `${m.role === 'user' ? 'Cliente' : 'Agente'}: ${content.substring(0, 160)}`;
    }).join('\n');
  }

  private async clearDefault(tenantId: string) {
    await this.repo.update({ tenantId, isDefault: true }, { isDefault: false });
  }
}
