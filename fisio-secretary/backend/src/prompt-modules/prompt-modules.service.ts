import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PromptModule } from '../common/entities/prompt-module.entity';
import { AiService, AiResponse } from '../ai/ai.service';
import { Lead } from '../common/entities/lead.entity';
import { MediaService } from '../media/media.service';

type ModuleInput = Partial<Pick<PromptModule, 'name' | 'isCore' | 'keywords' | 'content' | 'isActive' | 'sortOrder' | 'injectsMediaCatalog'>>;

// Schema JSON compartilhado por todo módulo/tenant deste motor — não tem campo
// "handoff" (não existe mais o conceito) nem capacidades condicionais por
// enquanto (protótipo: todo módulo pode agendar/mandar mídia).
const JSON_SCHEMA = `RESPONDA SEMPRE em JSON com este formato exato (NÃO inclua campos além destes):
{
  "reply": "texto da resposta para a cliente",
  "stage": "novo_lead|lead_frio|lead_quente|agendado|perdido",
  "temperature": "quente|morno|frio",
  "action": "none|schedule|send_media",
  "mediaName": "id exato do catálogo (ou array de ids p/ vários vídeos) — só com action=send_media",
  "appointmentDateTime": "YYYY-MM-DDTHH:MM:SS — só com action=schedule",
  "tags": [],
  "shouldIgnore": false,
  "fields": { "name": "nome se coletado ou null" }
}`;

const HISTORY_WINDOW = 16;

// Remove o JSON bruto do histórico de turnos do assistente, deixando só o
// texto da resposta (mesmo tratamento que o multi-agente já faz em
// slimHistoryForLlm — o modelo não deve ver o próprio JSON como se fosse
// texto natural que ele "falou").
function slimHistory(history: any[]): any[] {
  const slimmed = history.map((m) => {
    if (m?.role !== 'assistant') return m;
    let content = typeof m.content === 'string' ? m.content : '';
    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed.reply === 'string') content = parsed.reply;
    } catch { /* já é texto puro */ }
    return { role: 'assistant', content };
  });
  return slimmed.slice(-HISTORY_WINDOW);
}

@Injectable()
export class PromptModulesService {
  private readonly logger = new Logger(PromptModulesService.name);

  constructor(
    @InjectRepository(PromptModule) private readonly repo: Repository<PromptModule>,
    private readonly aiService: AiService,
    private readonly mediaService: MediaService,
  ) {}

  findAll(tenantId: string) {
    return this.repo.find({ where: { tenantId }, order: { isCore: 'DESC', sortOrder: 'ASC', createdAt: 'ASC' } });
  }

  async create(tenantId: string, body: ModuleInput) {
    if (!body?.name?.trim()) throw new BadRequestException('Nome é obrigatório');
    if (body.isCore) {
      const existingCore = await this.repo.findOne({ where: { tenantId, isCore: true } });
      if (existingCore) throw new BadRequestException('Já existe um bloco fixo (core) pra este tenant — edite o existente em vez de criar outro.');
    }
    const module = this.repo.create({
      tenantId,
      name: body.name.trim(),
      isCore: body.isCore ?? false,
      keywords: body.keywords ?? '',
      content: body.content ?? '',
      isActive: body.isActive ?? true,
      sortOrder: body.sortOrder ?? 0,
      injectsMediaCatalog: body.injectsMediaCatalog ?? false,
    });
    return this.repo.save(module);
  }

  async update(tenantId: string, id: string, body: ModuleInput) {
    const module = await this.repo.findOne({ where: { id, tenantId } });
    if (!module) throw new NotFoundException('Módulo não encontrado');
    if (body.name !== undefined) module.name = body.name.trim();
    if (body.isCore !== undefined) module.isCore = body.isCore;
    if (body.keywords !== undefined) module.keywords = body.keywords;
    if (body.content !== undefined) module.content = body.content;
    if (body.isActive !== undefined) module.isActive = body.isActive;
    if (body.sortOrder !== undefined) module.sortOrder = body.sortOrder;
    if (body.injectsMediaCatalog !== undefined) module.injectsMediaCatalog = body.injectsMediaCatalog;
    return this.repo.save(module);
  }

  async remove(tenantId: string, id: string) {
    const module = await this.repo.findOne({ where: { id, tenantId } });
    if (!module) throw new NotFoundException('Módulo não encontrado');
    await this.repo.remove(module);
    return { ok: true };
  }

  // Seleciona módulos (não-core) cujo padrão de `keywords` (1 por linha, regex
  // ou texto simples — tenta regex, cai pra includes() se inválida) bate na
  // mensagem atual. Se nada bater, mantém os módulos do turno anterior
  // (continuidade — respostas curtas tipo "100"/"sim" não têm palavra-chave
  // própria, mas o assunto continua o mesmo).
  selectModules(message: string, allModules: PromptModule[], previousModuleNames: string[]): PromptModule[] {
    const candidates = allModules.filter((m) => !m.isCore && m.isActive);
    const matched = candidates.filter((m) => {
      const patterns = m.keywords.split('\n').map((k) => k.trim()).filter(Boolean);
      return patterns.some((p) => {
        try {
          return new RegExp(p, 'i').test(message);
        } catch {
          return message.toLowerCase().includes(p.toLowerCase());
        }
      });
    });
    if (matched.length > 0) return matched;

    const prevSet = new Set(previousModuleNames ?? []);
    return candidates.filter((m) => prevSet.has(m.name));
  }

  // Catálogo de mídia sempre fresco (não fica salvo no `content` do módulo,
  // que ficaria desatualizado assim que o cliente cadastrasse/renomeasse
  // vídeo — ver bug real encontrado em 2026-07-10 no alex_teste).
  private buildMediaCatalogBlock(mediaNames: string[]): string {
    if (!mediaNames.length) return 'CATÁLOGO DE MÍDIAS: nenhuma mídia cadastrada ainda. Não ofereça vídeos.';
    return `CATÁLOGO DE MÍDIAS DISPONÍVEIS (lista atual, sempre atualizada):\n${mediaNames.map((n) => `- "${n}"`).join('\n')}\n\nUse em "mediaName" EXATAMENTE um dos nomes acima, copiado letra por letra (maiúsculas/minúsculas/espaços/acentos). NUNCA invente um nome fora desta lista. Se a cliente pedir algo que não bate exatamente, escolha o mais próximo (mesma textura, tamanho mais parecido) dentre os nomes acima.`;
  }

  buildSystemPrompt(core: PromptModule | undefined, selected: PromptModule[], mediaNames: string[]): string {
    const moduleBlocks = selected.map((m) => {
      if (!m.injectsMediaCatalog) return m.content;
      return [m.content, this.buildMediaCatalogBlock(mediaNames)].filter(Boolean).join('\n\n');
    });
    const parts = [core?.content ?? '', ...moduleBlocks, JSON_SCHEMA];
    return parts.filter((p) => p?.trim()).join('\n\n');
  }

  // ───────────────── Fluxo de PRODUÇÃO (webhook WhatsApp) ─────────────────
  // Espelha o formato relevante de AgentsService.chatForLead — quem chama
  // (evolution.controller.ts) só precisa do aiResponse pro pós-processamento
  // padrão (loop/tags/mídia/agendamento) e do moduleNames pra persistir em
  // lead.activeModules (continuidade no próximo turno).
  async chatForLead(
    tenantId: string,
    lead: Lead,
    message: string,
  ): Promise<{ aiResponse: AiResponse; moduleNames: string[] } | null> {
    const allModules = await this.repo.find({ where: { tenantId, isActive: true } });
    if (!allModules.length) return null;
    const core = allModules.find((m) => m.isCore);
    const selected = this.selectModules(message, allModules, lead.activeModules ?? []);
    const mediaNames = selected.some((m) => m.injectsMediaCatalog)
      ? (await this.mediaService.listAll(tenantId)).map((m) => m.name)
      : [];
    const systemPrompt = this.buildSystemPrompt(core, selected, mediaNames);

    const history = slimHistory((lead.aiContext as any[]) ?? []);
    const messages = [...history, { role: 'user', content: message }];

    const aiResponse = await this.aiService.processDynamicPrompt(tenantId, systemPrompt, messages);
    const moduleNames = selected.map((m) => m.name);
    this.logger.log(`[DYNAMIC] módulos=[${moduleNames.join(',') || '-'}] tenant=${tenantId}`);
    return { aiResponse, moduleNames };
  }

  // ───────────────── Fluxo de TESTE (tela de simulação) ─────────────────
  // Sem persistir Lead — o estado (aiContext + módulos ativos) roda de ida e
  // volta com o frontend a cada turno, igual ao chatTest do multi-agente.
  async chatTest(
    tenantId: string,
    message: string,
    previousModuleNames: string[],
    aiContext: any[],
    modelOverride?: string,
  ) {
    if (!message?.trim()) throw new BadRequestException('Mensagem é obrigatória');
    const allModules = await this.repo.find({ where: { tenantId, isActive: true } });
    if (!allModules.length) throw new BadRequestException('Nenhum módulo cadastrado pra este tenant');
    const core = allModules.find((m) => m.isCore);
    const selected = this.selectModules(message, allModules, previousModuleNames ?? []);
    const mediaNames = selected.some((m) => m.injectsMediaCatalog)
      ? (await this.mediaService.listAll(tenantId)).map((m) => m.name)
      : [];
    const systemPrompt = this.buildSystemPrompt(core, selected, mediaNames);

    const history = slimHistory(aiContext ?? []);
    const messages = [...history, { role: 'user', content: message }];

    const aiResponse = await this.aiService.processDynamicPrompt(tenantId, systemPrompt, messages, modelOverride);
    const updatedContext = [
      ...(aiContext ?? []),
      { role: 'user', content: message },
      { role: 'assistant', content: aiResponse.rawJson ?? aiResponse.reply },
    ];

    return {
      reply: aiResponse.reply,
      moduleNames: selected.map((m) => m.name),
      stage: aiResponse.stage,
      temperature: aiResponse.temperature,
      action: aiResponse.action,
      mediaName: aiResponse.mediaName,
      tags: aiResponse.tags,
      shouldIgnore: aiResponse.shouldIgnore,
      aiContext: updatedContext,
      tokenUsage: aiResponse.tokenUsage,
      systemPromptChars: systemPrompt.length,
    };
  }
}
