import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Agent } from '../common/entities/agent.entity';
import { AiService } from '../ai/ai.service';

type AgentInput = Partial<Pick<Agent,
  'name' | 'description' | 'respondsTo' | 'handoffWhen' | 'systemPrompt' | 'isActive' | 'isDefault' | 'sortOrder'>>;

@Injectable()
export class AgentsService {
  constructor(
    @InjectRepository(Agent) private readonly repo: Repository<Agent>,
    private readonly aiService: AiService,
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

  // Simula uma mensagem dentro de uma conversa com agente atual definido.
  // Retorna resposta do agente e, se houve handoff, o novo agente.
  async chat(tenantId: string, message: string, currentAgentId: string | null) {
    if (!message?.trim()) throw new BadRequestException('Mensagem é obrigatória');
    const active = await this.repo.find({
      where: { tenantId, isActive: true },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    if (!active.length) throw new BadRequestException('Conecte ao menos um agente ao supervisor');

    const roster = active.map((a) => ({ id: a.id, name: a.name, description: a.description, respondsTo: a.respondsTo }));

    // Resolve agente atual: usa o informado ou roteia pelo supervisor
    let currentAgent = active.find((a) => a.id === currentAgentId) ?? null;
    if (!currentAgent) {
      const { agentId } = await this.aiService.routeToAgent(message, roster);
      currentAgent = active.find((a) => a.id === agentId) ?? active[0];
    }

    // Agente responde
    const reply = await this.aiService.simulateAgentReply(currentAgent.name, currentAgent.systemPrompt, message);
    const hasHandoff = reply.includes('[HANDOFF_SUPERVISOR]');
    const cleanReply = reply.replace(/\[HANDOFF_SUPERVISOR\]/g, '').trim();

    if (!hasHandoff) {
      return {
        reply: cleanReply,
        agentId: currentAgent.id,
        agentName: currentAgent.name,
        handoffOccurred: false,
        transferredFrom: null,
      };
    }

    // Handoff: supervisor roteia pra outro agente (excluindo o atual)
    const remaining = roster.filter((a) => a.id !== currentAgent.id);
    const { agentId: newId } = await this.aiService.routeToAgent(message, remaining.length ? remaining : roster);
    const newAgent = active.find((a) => a.id === newId) ?? active.find((a) => a.id !== currentAgent.id) ?? active[0];

    // Novo agente responde
    const newReply = await this.aiService.simulateAgentReply(newAgent.name, newAgent.systemPrompt, message);

    return {
      reply: newReply.replace(/\[HANDOFF_SUPERVISOR\]/g, '').trim(),
      agentId: newAgent.id,
      agentName: newAgent.name,
      handoffOccurred: true,
      transferredFrom: currentAgent.name,
    };
  }

  private async clearDefault(tenantId: string) {
    await this.repo.update({ tenantId, isDefault: true }, { isDefault: false });
  }
}
