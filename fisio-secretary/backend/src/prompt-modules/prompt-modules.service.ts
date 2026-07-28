import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PromptModule } from '../common/entities/prompt-module.entity';
import { AiService, AiResponse, buildDateBlock, buildMiniDateBlock, AGENT_SCHEDULING_RULES } from '../ai/ai.service';
import { Lead } from '../common/entities/lead.entity';
import { MediaService } from '../media/media.service';

type ModuleInput = Partial<Pick<PromptModule, 'name' | 'isCore' | 'keywords' | 'content' | 'isActive' | 'sortOrder' | 'injectsMediaCatalog' | 'injectsDateTable'>>;

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
  "appointmentDateTime": "YYYY-MM-DDTHH:MM:SS — só com action=schedule, SEMPRE usando a TABELA DE DATAS (nunca calcule de cabeça)",
  "appointmentService": "mega_hair|manutencao|null",
  "appointmentValue": null,
  "tags": [],
  "shouldIgnore": false,
  "fields": { "name": "nome se coletado ou null" }
}`;

const HISTORY_WINDOW = 16;

// O modelo às vezes imita no reply as anotações internas de histórico
// ("[sistema: vídeo enviado ...]") — nunca podem chegar na cliente.
function stripInternalMarkers(reply: string | undefined): string {
  return (reply ?? '').replace(/\[sistema:[^\]]*\]/gi, '').replace(/ {2,}/g, ' ').trim();
}

// Remove o JSON bruto do histórico de turnos do assistente, deixando só o
// texto da resposta (mesmo tratamento que o multi-agente já faz em
// slimHistoryForLlm — o modelo não deve ver o próprio JSON como se fosse
// texto natural que ele "falou"). Exceção: quando o turno enviou mídia,
// preserva um marcador — sem ele o modelo não tem como saber que o vídeo
// já foi mostrado (causava reenvio do mesmo vídeo e quebrava a regra
// "vídeo antes do preço", que depende de conferir o histórico).
function slimHistory(history: any[]): any[] {
  const slimmed = history.map((m) => {
    if (m?.role !== 'assistant') return m;
    let content = typeof m.content === 'string' ? m.content : '';
    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed.reply === 'string') {
        content = parsed.reply;
        if (parsed.action === 'send_media' && parsed.mediaName) {
          const names = Array.isArray(parsed.mediaName) ? parsed.mediaName : [parsed.mediaName];
          content += `\n[sistema: vídeo enviado nesta conversa: ${names.join(', ')}]`;
        }
      }
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
      injectsDateTable: body.injectsDateTable ?? false,
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
    if (body.injectsDateTable !== undefined) module.injectsDateTable = body.injectsDateTable;
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
  // mensagem atual OU na última pergunta da própria IA (`priorAssistantText`).
  // Isso cobre o caso de resposta curta a uma pergunta composta da IA — ex.:
  // IA pergunta "quer ver outro vídeo ou saber o valor?" e a cliente responde
  // só "sim": a palavra-chave "valor" não está na mensagem dela, mas está na
  // pergunta que ela está respondendo. Sem isso, o módulo de preço nunca
  // carrega e o modelo fica sem a tabela pra responder — e inventa um valor
  // em vez de seguir a regra do Core (bug real: preço inventado em prod,
  // 2026-07-22, tenant alexcosta171@yahoo.com).
  // Se nada bater (nem na mensagem, nem na pergunta anterior), em vez de só
  // repetir os módulos do turno anterior, pergunta pra uma IA barata qual
  // módulo é necessário (rede de segurança contra keyword mal escrita/
  // corrompida ou mensagem fora do padrão previsto — ver
  // project_alex_price_hallucination_fix na memória). Só cai na continuidade
  // pura (turno anterior) se a IA também não apontar nada.
  async selectModules(
    tenantId: string,
    message: string,
    allModules: PromptModule[],
    previousModuleNames: string[],
    priorAssistantText?: string,
  ): Promise<PromptModule[]> {
    const candidates = allModules.filter((m) => !m.isCore && m.isActive);
    const haystack = priorAssistantText ? `${priorAssistantText}\n${message}` : message;
    const matched = candidates.filter((m) => {
      const patterns = m.keywords.split('\n').map((k) => k.trim()).filter(Boolean);
      return patterns.some((p) => {
        try {
          return new RegExp(p, 'i').test(haystack);
        } catch {
          return haystack.toLowerCase().includes(p.toLowerCase());
        }
      });
    });
    if (matched.length > 0) return matched;

    const aiChosenNames = await this.aiService.classifyModules(
      message,
      priorAssistantText ?? '',
      candidates.map((m) => ({ name: m.name, keywords: m.keywords })),
      { tenantId },
    );
    if (aiChosenNames.length > 0) {
      return candidates.filter((m) => aiChosenNames.includes(m.name));
    }

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
    // Bloco de data SEMPRE por último — é a única parte variável do prompt
    // (calculada em código, muda a cada dia/hora), então mantê-la no final
    // preserva o cache do resto do prefixo entre chamadas (mesmo padrão do
    // multiagente/monólito). Tabela completa (+ regras de agendamento) só
    // quando algum módulo selecionado precisa converter datas relativas
    // ("amanhã") num appointmentDateTime real — senão só a versão enxuta
    // (dia de hoje + saudação), que toda conversa precisa de qualquer forma.
    const needsFullDateTable = selected.some((m) => m.injectsDateTable);
    const dateTail = needsFullDateTable
      ? [AGENT_SCHEDULING_RULES, buildDateBlock()].join('\n\n')
      : buildMiniDateBlock();
    const parts = [core?.content ?? '', ...moduleBlocks, JSON_SCHEMA, dateTail];
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
    imageUrl?: string,
  ): Promise<{ aiResponse: AiResponse; moduleNames: string[] } | null> {
    const allModules = await this.repo.find({ where: { tenantId, isActive: true } });
    if (!allModules.length) return null;
    const core = allModules.find((m) => m.isCore);
    const history = slimHistory((lead.aiContext as any[]) ?? []);
    const priorAssistantText = [...history].reverse().find((m) => m.role === 'assistant')?.content ?? '';
    const selected = await this.selectModules(tenantId, message, allModules, lead.activeModules ?? [], priorAssistantText);
    const mediaNames = selected.some((m) => m.injectsMediaCatalog)
      ? (await this.mediaService.listAll(tenantId)).map((m) => m.name)
      : [];
    const systemPrompt = this.buildSystemPrompt(core, selected, mediaNames);

    // Imagem só entra no conteúdo multimodal desta chamada — o que fica
    // persistido em lead.aiContext (via aiService.buildUpdatedContext, chamado
    // pelo controller com o combinedText original) é sempre o texto puro, então
    // a foto nunca é reenviada como histórico nas próximas mensagens.
    const userContent: any = imageUrl
      ? [
          { type: 'text', text: message },
          { type: 'image_url', image_url: { url: imageUrl } },
        ]
      : message;
    const messages = [...history, { role: 'user', content: userContent }];

    const aiResponse = await this.aiService.processDynamicPrompt(tenantId, systemPrompt, messages);
    aiResponse.reply = stripInternalMarkers(aiResponse.reply);
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
    const history = slimHistory(aiContext ?? []);
    const priorAssistantText = [...history].reverse().find((m) => m.role === 'assistant')?.content ?? '';
    const selected = await this.selectModules(tenantId, message, allModules, previousModuleNames ?? [], priorAssistantText);
    const mediaNames = selected.some((m) => m.injectsMediaCatalog)
      ? (await this.mediaService.listAll(tenantId)).map((m) => m.name)
      : [];
    const systemPrompt = this.buildSystemPrompt(core, selected, mediaNames);

    const messages = [...history, { role: 'user', content: message }];

    const aiResponse = await this.aiService.processDynamicPrompt(tenantId, systemPrompt, messages, modelOverride);
    aiResponse.reply = stripInternalMarkers(aiResponse.reply);
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
      appointmentDateTime: aiResponse.appointmentDateTime,
      tags: aiResponse.tags,
      shouldIgnore: aiResponse.shouldIgnore,
      aiContext: updatedContext,
      tokenUsage: aiResponse.tokenUsage,
      systemPromptChars: systemPrompt.length,
    };
  }
}
