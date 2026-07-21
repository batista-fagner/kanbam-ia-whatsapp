import { Controller, Post, Get, Body, Query, Param, Res, Logger, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { EvolutionService } from './evolution.service';
import { MessageQueueService } from './message-queue.service';
import { WhatsappConfigService } from './whatsapp-config.service';
import { UazapiProvider } from './providers/uazapi.provider';
import { LeadsService } from '../leads/leads.service';
import { AiService, AiResponse } from '../ai/ai.service';
import { LeadsGateway } from '../leads/leads.gateway';
import { CalendarService } from '../calendar/calendar.service';
import { AudioService } from '../audio/audio.service';
import { MediaService } from '../media/media.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { AgentsService } from '../agents/agents.service';
import { PromptModulesService } from '../prompt-modules/prompt-modules.service';

@Controller('webhooks')
export class EvolutionController {
  private readonly logger = new Logger(EvolutionController.name);
  private readonly processedIds = new Set<string>();
  // Rastreia se a última mensagem recebida de um phone foi áudio (para responder em áudio)
  private readonly lastMessageWasAudio = new Map<string, boolean>();
  // Rastreia qual tenant já recebeu notificação de limite de vídeo hoje (chave: tenantId, valor: data BRT)
  private readonly mediaLimitNotifiedDate = new Map<string, string>();

  constructor(
    private readonly evolutionService: EvolutionService,
    private readonly messageQueue: MessageQueueService,
    private readonly whatsappConfigService: WhatsappConfigService,
    private readonly uazapiProvider: UazapiProvider,
    private readonly leadsService: LeadsService,
    private readonly aiService: AiService,
    private readonly leadsGateway: LeadsGateway,
    private readonly calendarService: CalendarService,
    private readonly audioService: AudioService,
    private readonly mediaService: MediaService,
    private readonly configService: ConfigService,
    private readonly appointmentsService: AppointmentsService,
    private readonly agentsService: AgentsService,
    private readonly promptModulesService: PromptModulesService,
  ) {}

  // Webhook multi-tenant: a URL carrega o tenantId. Toda instância (incl. legadas
  // já migradas) posta aqui. A rota sem tenantId foi removida — ela resolvia pelo
  // "mais recente" e misturava clientes quando havia 2+ tenants.
  @Post('uazapi/:tenantId')
  async handleUazapiWebhookTenant(@Param('tenantId') tenantId: string, @Body() body: any) {
    return this.handleUazapiWebhook(tenantId, body);
  }

  private async handleUazapiWebhook(tenantId: string, body: any) {
    if (body.EventType !== 'messages') return { ok: true };

    const message = body.message;
    if (!message || message.isGroup) return { ok: true };

    // Reação a uma mensagem (ex: 😍 num balão) não é uma mensagem de verdade — ignora,
    // senão a IA responde ao emoji e o cliente reage de novo, entrando num loop de reações.
    if (message.type === 'reaction' || message.messageType === 'reaction' || message.reaction) {
      return { ok: true };
    }

    const rawPhone: string = body.chat?.phone ?? '';
    const phone = rawPhone.replace(/\D/g, '');

    // Mensagem enviada pelo próprio operador via WhatsApp (celular/Web), não pela API:
    // - a palavra configurada em deactivationKeyword (padrão 'opa') desativa a IA daquele lead
    // - a palavra configurada em activationKeyword (padrão 'volta') reativa a IA daquele lead
    // - qualquer outra mensagem é salva como conversa do operador (sincroniza com o card)
    if (message.fromMe && !message.wasSentByApi) {
      const operatorText = (message.text ?? '').trim();
      if (!phone) return { ok: true };

      const messageId: string = message.messageid;
      if (messageId && this.processedIds.has(messageId)) return { ok: true };
      if (messageId) {
        this.processedIds.add(messageId);
        setTimeout(() => this.processedIds.delete(messageId), 5 * 60 * 1000);
      }

      try {
        const { lead, conversation } = await this.leadsService.findOrCreate(phone, tenantId);

        const tenantConfig = await this.whatsappConfigService.getByTenant(tenantId);
        const deactivationKeyword = (tenantConfig?.deactivationKeyword || 'opa').toLowerCase();
        const activationKeyword = (tenantConfig?.activationKeyword || 'volta').toLowerCase();

        if (operatorText.toLowerCase() === deactivationKeyword) {
          await this.leadsService.toggleAi(lead.id, false);
          this.logger.log(`🛑 [DEACTIVATE] Operador assumiu conversa de ${phone} via WhatsApp — IA desativada (palavra: "${deactivationKeyword}")`);
        } else if (operatorText.toLowerCase() === activationKeyword) {
          await this.leadsService.toggleAi(lead.id, true);
          this.logger.log(`✅ [ACTIVATE] IA reativada para ${phone} via WhatsApp (palavra: "${activationKeyword}")`);
        } else if (operatorText) {
          await this.leadsService.saveMessage(conversation.id, 'outbound', 'operator', operatorText, messageId);
          this.logger.log(`📥 [OP-WHATSAPP] ${phone}: ${operatorText.substring(0, 40)}`);
        } else {
          return { ok: true };
        }

        const updatedLead = await this.leadsService.findOne(lead.id);
        this.leadsGateway.emitLeadUpdated(updatedLead);
      } catch (err) {
        this.logger.error(`Erro ao processar msg do operador de ${phone}: ${err.message}`);
      }
      return { ok: true };
    }

    // Mensagens enviadas pela própria IA via API — ignora (echo do que enviamos)
    if (message.wasSentByApi) return { ok: true };

    const rawText: string = message.text;
    const isAudio = message.type === 'media' && ['audio', 'ptt', 'myaudio'].includes(message.mediaType);
    const isImage = message.type === 'media' && message.mediaType === 'image';
    const text: string = (isImage && rawText) ? `[imagem] ${rawText}` : rawText;
    const pushName: string | null = body.chat?.name ?? body.chat?.wa_name ?? message?.senderName ?? null;

    if (!phone) return { ok: true };

    // Imagem sem caption: a IA ainda não lê imagens. No agente MegaHair, pede pra cliente descrever o cabelo.
    if (isImage && !text) {
      const messageId: string = message.messageid;
      if (messageId && this.processedIds.has(messageId)) return { ok: true };
      if (messageId) {
        this.processedIds.add(messageId);
        setTimeout(() => this.processedIds.delete(messageId), 5 * 60 * 1000);
      }

      try {
        const { lead, conversation } = await this.leadsService.findOrCreate(phone, tenantId, pushName);
        await this.leadsService.saveMessage(conversation.id, 'inbound', phone, '[imagem]', messageId);

        const reply = 'oi! ainda não consigo ver imagens por aqui 😅 vc pode me dizer se o cabelo é liso, ondulado ou cacheado?';
        const tenantToken = await this.whatsappConfigService.getTokenByTenant(tenantId);
        await this.evolutionService.sendTextMessage(phone, reply, tenantToken);
        await this.leadsService.saveMessage(conversation.id, 'outbound', 'ai', reply);

        const updatedLead = await this.leadsService.findOne(lead.id);
        this.leadsGateway.emitLeadUpdated(updatedLead);
      } catch (err) {
        this.logger.error(`Erro ao tratar imagem de ${phone}: ${err.message}`);
      }
      return { ok: true };
    }

    if (!text && !isAudio) return { ok: true };

    // Ignora mensagens antigas — timestamp já em milissegundos na uazapi
    const messageTimestamp: number = message.messageTimestamp;
    if (messageTimestamp) {
      const ageSeconds = (Date.now() - messageTimestamp) / 1000;
      if (ageSeconds > 300) {
        this.logger.warn(`Mensagem ignorada — muito antiga (${Math.round(ageSeconds)}s): ${phone}`);
        return { ok: true };
      }
    }

    // Deduplicação por messageid
    const messageId: string = message.messageid;
    if (this.processedIds.has(messageId)) {
      this.logger.warn(`Webhook duplicado ignorado: ${messageId}`);
      return { ok: true };
    }
    this.processedIds.add(messageId);
    setTimeout(() => this.processedIds.delete(messageId), 5 * 60 * 1000);

    // Chave composta tenant:phone — evita misturar filas de clientes diferentes
    // quando a mesma pessoa fala com dois negócios distintos.
    const queueKey = `${tenantId}:${phone}`;
    this.lastMessageWasAudio.set(queueKey, isAudio);

    if (isAudio) {
      this.transcribeAndEnqueue(tenantId, phone, message, messageId, pushName).catch((err) =>
        this.logger.error(`Erro ao transcrever áudio de ${phone}: ${err.message}`),
      );
      return { ok: true };
    }

    this.logger.log(`Mensagem recebida de ${phone}${pushName ? ` (${pushName})` : ''}: ${text}`);

    this.messageQueue.enqueue(queueKey, text, (combinedText) => {
      this.logger.log(`[PROCESSANDO] messageId=${messageId}, phone=${phone}, texto="${combinedText.substring(0, 40)}..."`);
      this.processMessage(tenantId, phone, combinedText, messageId, pushName).catch((err) => {
        this.logger.error(`❌ [ERRO AO PROCESSAR] ${phone}: ${err.message}`);
        this.logger.error(`❌ [ERRO AO PROCESSAR] Stack: ${err.stack}`);
      });
    });

    return { ok: true };
  }

  private async transcribeAndEnqueue(tenantId: string, phone: string, message: any, messageId: string, pushName?: string | null) {
    this.logger.log(`Transcrevendo áudio de ${phone}...`);
    const tenantToken = await this.whatsappConfigService.getTokenByTenant(tenantId);
    const transcribedText = await this.evolutionService.transcribeAudio(message.messageid, tenantToken);
    this.logger.log(`Áudio transcrito de ${phone}: "${transcribedText}"`);

    const queueKey = `${tenantId}:${phone}`;
    this.messageQueue.enqueue(queueKey, transcribedText, (combinedText) => {
      this.processMessage(tenantId, phone, combinedText, messageId, pushName).catch((err) =>
        this.logger.error(`Erro ao processar áudio transcrito de ${phone}: ${err.message}`),
      );
    });
  }

  // Detecta quando a IA está prestes a enviar a mesma resposta pela 3ª vez seguida (loop de repetição).
  // Se detectado, desativa a IA e bloqueia o envio — evita gastar tokens/mensagens num loop infinito.
  private async detectAndBlockLoop(
    conversationId: string,
    leadId: string,
    tenantId: string,
    phone: string,
    reply: string | undefined,
  ): Promise<boolean> {
    const normalized = reply?.trim().toLowerCase();
    if (!normalized) return false;
    const lastReplies = await this.leadsService.getLastAiReplies(conversationId, 2);
    const isLoop = lastReplies.length === 2 && lastReplies.every((r) => r.trim().toLowerCase() === normalized);
    if (isLoop) {
      await this.leadsService.toggleAi(leadId, false, tenantId);
      this.logger.warn(`🔁 [LOOP] Resposta repetida 3x seguidas detectada para ${phone} (tenant ${tenantId}) — IA desativada automaticamente, envio bloqueado`);
      await this.notifyLoopDetected(tenantId, leadId, phone, reply!);
    }
    return isLoop;
  }

  // Envia um alerta via WhatsApp SOMENTE para o número fixo de monitoramento (ADMIN_ALERT_PHONE)
  // quando um loop de repetição é detectado e a IA é desativada automaticamente.
  private async notifyLoopDetected(tenantId: string, leadId: string, phone: string, repeatedReply: string): Promise<void> {
    const adminPhone = this.configService.get<string>('ADMIN_ALERT_PHONE');
    const adminToken = this.configService.get<string>('UAZAPI_TOKEN');
    if (!adminPhone || !adminToken) return;

    try {
      const [lead, tenantConfig] = await Promise.all([
        this.leadsService.findOne(leadId),
        this.whatsappConfigService.getByTenant(tenantId),
      ]);
      const tenantName = tenantConfig?.displayName ?? tenantId;
      const baseUrl = this.configService.get<string>('UAZAPI_BASE_URL') ?? '';
      const alertText = `⚠️ *Loop de repetição detectado!*\n\nLead: *${lead?.name || phone}*\nTenant: *${tenantName}*\nResposta repetida 3x seguidas:\n"${repeatedReply.substring(0, 200)}"\n\nA IA foi desativada automaticamente. Verifique o Kanban.`;
      await axios.post(`${baseUrl}/send/text`, { number: adminPhone, text: alertText }, { headers: { token: adminToken } });
      this.logger.warn(`[LOOP-ALERT] Alerta enviado para ${adminPhone} — lead ${lead?.name || phone} (tenant ${tenantName})`);
    } catch (err) {
      this.logger.error(`[LOOP-ALERT] Falha ao enviar alerta de loop: ${err.message}`);
    }
  }

  private async processMessage(tenantId: string, phone: string, combinedText: string, messageKeyId: string, pushName?: string | null) {
    const { lead, conversation } = await this.leadsService.findOrCreate(phone, tenantId, pushName);

    await this.leadsService.saveMessage(conversation.id, 'inbound', phone, combinedText, messageKeyId);
    await this.leadsService.update(lead.id, { lastMessageAt: new Date() });

    // Se IA desativada (etiquetado como inativo), apenas salva e notifica frontend — nunca responde
    const aiEnabled = await this.leadsService.getAiEnabled(lead.id);
    if (!aiEnabled) {
      this.logger.log(`IA desativada para ${phone} — mensagem ignorada (lead etiquetado ou operador assumiu)`);
      const updatedLead = await this.leadsService.findOne(lead.id);
      this.leadsGateway.emitLeadUpdated(updatedLead);
      return;
    }

    // Proteção anti-loop/economia de token: com a IA ligada, a cada 100 msgs inbound,
    // desliga a IA e alerta o admin. Se a IA já estiver desligada (operador assumiu),
    // essa checagem é ignorada (aiEnabled já retornou acima).
    const msgCount = await this.leadsService.countInboundMessages(conversation.id);
    if (msgCount > 0 && msgCount % 100 === 0) {
      const adminPhone = this.configService.get<string>('ADMIN_ALERT_PHONE');
      const adminToken = this.configService.get<string>('UAZAPI_TOKEN');
      if (adminPhone && adminToken) {
        const baseUrl = this.configService.get<string>('UAZAPI_BASE_URL') ?? '';
        const tenantName = (await this.whatsappConfigService.getByTenant(tenantId))?.displayName ?? tenantId;
        const alertText = `⚠️ *Conversa muito longa com a IA!*\n\nLead: *${lead.name || phone}*\nTenant: *${tenantName}*\nMensagens: *${msgCount} msgs*\n\nA IA foi desativada automaticamente. Verifique o Kanban.`;
        try {
          await axios.post(`${baseUrl}/send/text`, { number: adminPhone, text: alertText }, { headers: { token: adminToken } });
          this.logger.warn(`[ANTI-LOOP] Alerta enviado ao admin — ${lead.name || phone} (${msgCount} msgs)`);
        } catch (err) {
          this.logger.error(`[ANTI-LOOP] Falha ao enviar alerta: ${err.message}`);
        }
      }
      await this.leadsService.toggleAi(lead.id, false);
      this.logger.warn(`[ANTI-LOOP] IA desligada — lead ${phone} (${msgCount} msgs)`);
      const updatedLead = await this.leadsService.findOne(lead.id);
      this.leadsGateway.emitLeadUpdated(updatedLead);
      return;
    }

    // Lead perdido voltou a falar (sem estar desativado): reinicia como lead_frio
    if (lead.stage === 'perdido') {
      await this.leadsService.updateStage(lead.id, 'lead_frio' as any, 'system');
      lead.stage = 'lead_frio' as any;
      this.logger.log(`Lead ${phone} era perdido — movido para lead_frio ao retornar`);
    }

    // Config + token do tenant — todo envio uazapi DEVE usar o token da instância deste cliente.
    const instanceConfig = await this.whatsappConfigService.getByTenant(tenantId);
    const tenantToken = instanceConfig?.instanceToken ?? undefined;

    // Mostra "digitando..." enquanto a IA processa
    void this.evolutionService.sendTypingIndicator(phone, 5000, tenantToken);

    const allMedia = await this.mediaService.listAll(tenantId);
    const mediaNames = allMedia.map(m => m.name);

    // Detecta links de Instagram (reel/post) e mapeia para mídia cadastrada
    const reelCodes = MediaService.extractReelCodes(combinedText);
    let extraSystemContext: string | undefined;
    if (reelCodes.length > 0) {
      const matchedMedia = allMedia.find(m =>
        Array.isArray(m.reelCodes) && m.reelCodes.some(c => reelCodes.includes(c)),
      );
      if (matchedMedia) {
        extraSystemContext = `════════ LINK DO INSTAGRAM RECONHECIDO ════════
A cliente enviou um link do Instagram que corresponde à mídia cadastrada:
- Mídia: ${matchedMedia.name}
- ID exato (use em mediaName se for enviar): "${matchedMedia.name}"

Use essa informação: a cliente JÁ definiu qual produto quer (textura e tamanho estão no nome da mídia). NÃO pergunte de novo textura/tamanho. Avance pra qualificação (REGRA #0 — perguntar se ela usa mega hair ou é primeira vez) ou, se ela já passou disso, ofereça enviar essa mídia.
═══════════════════════════════════════════════════`;
        this.logger.log(`📷 [REEL MATCH] ${lead.phone} → mídia "${matchedMedia.name}"`);
      } else {
        extraSystemContext = `════════ LINK DO INSTAGRAM NÃO RECONHECIDO ════════
A cliente enviou um link do Instagram, mas o reel/post NÃO está cadastrado no catálogo da loja. Vc NÃO consegue ver o conteúdo do link.

NUNCA finja que viu o vídeo/foto. Responda pedindo descrição em palavras: "Recebi seu link, linda! Mas aqui no nosso sistema não abre. Me conta: o cabelo que você gostou é ondulado ou cacheado? E mais ou menos qual tamanho em cm? 😊"

Se a REGRA #0 (qualificação) ainda não foi atendida, pergunte ela ANTES de pedir textura/tamanho.
═══════════════════════════════════════════════════`;
        this.logger.log(`📷 [REEL UNKNOWN] ${lead.phone} → codes=${reelCodes.join(',')}`);
      }
    }

    // ── AGENTE ÚNICO + MÓDULOS DINÂMICOS (protótipo, 2026-07) ──────────────
    // Gate por tenant (whatsapp_config.prompt_engine='dynamic_modules') — hoje
    // só ligado pro alex_teste. Mesma resposta JSON, mesmo pós-processamento
    // abaixo; a diferença é que não há handoff/agentId, só o registro de quais
    // módulos foram carregados (persistido pra continuidade no próximo turno).
    let aiResponse: AiResponse | null = null;
    if (instanceConfig?.promptEngine === 'dynamic_modules') {
      try {
        const result = await this.promptModulesService.chatForLead(tenantId, lead, combinedText);
        if (result) {
          aiResponse = result.aiResponse;
          await this.leadsService.update(lead.id, { activeModules: result.moduleNames } as any);
          this.logger.log(`[DYNAMIC-MODULES] módulos=[${result.moduleNames.join(',') || '-'}] (${phone})`);
        } else {
          this.logger.warn(`[DYNAMIC-MODULES] Tenant ${tenantId} sem módulos cadastrados — usando fluxo single-prompt`);
        }
      } catch (err) {
        this.logger.error(`[DYNAMIC-MODULES] Erro ao processar (${phone}): ${err?.message} — fallback pro fluxo single-prompt`);
      }
    }

    // ── MULTI-AGENTE ──────────────────────────────────────────────────────
    // O agente atual do lead responde com o MESMO contrato JSON do single-prompt;
    // a resposta cai no MESMO pós-processamento abaixo (loop, tags, agendamento,
    // mídia, envio). Handoff entre agentes é resolvido dentro do chatForLead.
    // Falha ou tenant sem agentes ativos → fallback pro fluxo single-prompt.
    if (!aiResponse && instanceConfig?.multiAgentEnabled) {
      try {
        const result = await this.agentsService.chatForLead(tenantId, lead, combinedText, mediaNames, extraSystemContext);
        if (result) {
          aiResponse = result.aiResponse;
          // Persiste o agente atual no lead pra próxima mensagem continuar com ele
          if (result.agentId !== lead.currentAgentId) {
            await this.leadsService.update(lead.id, { currentAgentId: result.agentId } as any);
          }
          if (result.handoffOccurred) {
            this.logger.log(`[MULTI-AGENT] Handoff: ${result.transferredFrom} → ${result.agentName} (${phone})`);
          } else {
            this.logger.log(`[MULTI-AGENT] ${result.agentName} respondeu (${phone})`);
          }
        } else {
          this.logger.warn(`[MULTI-AGENT] Tenant ${tenantId} sem agentes ativos — usando fluxo single-prompt`);
        }
      } catch (err) {
        this.logger.error(`[MULTI-AGENT] Erro ao processar (${phone}): ${err?.message} — fallback pro fluxo single-prompt`);
      }
    }

    if (!aiResponse) {
      // Sem prompt configurado → IA não responde (cada cliente tem seu próprio prompt)
      // Mensagem já foi salva acima (saveMessage inbound) — não salva de novo
      if (instanceConfig?.agentType === 'megahair' && !instanceConfig?.customPromptMegaHair?.trim()) {
        this.logger.warn(`[MEGAHAIR] Prompt não configurado para tenant ${tenantId} — mensagem ignorada`);
        const updatedLead = await this.leadsService.findOne(lead.id);
        this.leadsGateway.emitLeadUpdated(updatedLead);
        return;
      }
      aiResponse = await this.aiService.processMessageMegaHair(lead, combinedText, mediaNames, instanceConfig?.customPromptMegaHair ?? undefined, extraSystemContext);
    }
    this.logger.log(`IA respondeu [stage=${aiResponse.stage}] [action=${aiResponse.action}] [tags=${JSON.stringify(aiResponse.tags ?? [])}]: ${aiResponse.reply}`);

    // CAMADA DE SEGURANÇA: resposta idêntica às 2 últimas (loop) → bloqueia envio e desativa a IA
    if (await this.detectAndBlockLoop(conversation.id, lead.id, tenantId, phone, aiResponse.reply)) {
      const updatedLead = await this.leadsService.findOne(lead.id);
      this.leadsGateway.emitLeadUpdated(updatedLead);
      return;
    }

    // Ações de calendário — roda ANTES do shouldIgnore: a IA pode confirmar um
    // agendamento e já encaminhar pro humano (shouldIgnore=true) na MESMA resposta
    // (ex: "Combinado! ... Vou deixar encaminhado com o Alex"). Se ficasse depois do
    // early-return do shouldIgnore, o agendamento nunca seria criado nesse caso.
    const action = aiResponse.action;

    // Agendamento interno (tabela appointments) — não usa Google Calendar
    if (action === 'schedule' && aiResponse.appointmentDateTime) {
      try {
        const startDateTime = this.parseBrazilianDateTime(aiResponse.appointmentDateTime);
        // Cancela agendamento anterior do mesmo lead antes de criar o novo (reagendamento)
        const canceled = await this.appointmentsService.cancelActiveByLeadId(lead.id);
        if (canceled > 0) {
          this.logger.log(`📅 [MEGAHAIR] ${canceled} agendamento(s) anterior(es) cancelado(s) para ${lead.phone}`);
        }
        await this.appointmentsService.create({
          tenantId,
          leadId: lead.id,
          clientName: lead.name || lead.phone,
          clientPhone: lead.phone,
          service: aiResponse.appointmentService ?? 'mega_hair',
          value: aiResponse.appointmentValue ?? null,
          status: 'agendado',
          startDateTime,
        });
        await this.leadsService.update(lead.id, { appointmentAt: startDateTime });
        this.logger.log(`📅 [MEGAHAIR] Agendamento criado para ${lead.phone} em ${startDateTime.toISOString()}`);
      } catch (err: any) {
        this.logger.error(`Erro ao criar agendamento MegaHair: ${err.message}`);
      }
    }

    if (action === 'cancel' && lead.calendarEventId) {
      await this.calendarService.cancelAppointment(lead.calendarEventId);
      await this.leadsService.update(lead.id, { calendarEventId: null, calendarEventLink: null, appointmentAt: null });
    }

    if (action === 'reschedule' && aiResponse.appointmentDateTime) {
      const newDateTime = this.parseBrazilianDateTime(aiResponse.appointmentDateTime);
      const { available, conflictingEvent } = await this.calendarService.checkAvailability(newDateTime);

      if (!available) {
        this.logger.warn(`Reagendamento bloqueado — horário ocupado: ${newDateTime.toISOString()}`);
        const busyReply = `Esse horário também está ocupado (${conflictingEvent}). Tem outro horário de preferência? 😊`;
        await this.evolutionService.sendTextMessage(phone, busyReply, tenantToken);
        await this.leadsService.saveMessage(conversation.id, 'outbound', 'ai', busyReply);
        const updatedLead = await this.leadsService.findOne(lead.id);
        this.leadsGateway.emitLeadUpdated(updatedLead);
        return;
      }

      if (lead.calendarEventId) {
        await this.calendarService.updateAppointment(lead.calendarEventId, newDateTime);
        await this.leadsService.update(lead.id, { appointmentAt: newDateTime });
      } else {
        const event = await this.calendarService.createAppointment({
          leadName: lead.name || lead.phone,
          phone: lead.phone,
          symptoms: lead.symptoms || '',
          startDateTime: newDateTime,
        });
        if (event) {
          await this.leadsService.update(lead.id, { calendarEventId: event.id, calendarEventLink: event.htmlLink, appointmentAt: newDateTime });
        }
      }
    }

    // CAMADA DE SEGURANÇA: Se shouldIgnore=true, não responder e sair
    if (aiResponse.shouldIgnore === true) {
      this.logger.warn(`Lead ${phone} marcado para ignorar. Aplicando etiquetas e não respondendo mais.`);

      // Se a IA pediu pra mandar mídia nesta mesma resposta (ex: último vídeo antes
      // de encaminhar pro humano), envia ANTES de desligar — senão o cliente fica
      // sem vídeo E sem texto (bug: o early-return abaixo pulava o bloco de mídia
      // que só rodava mais adiante no fluxo normal).
      let mediaSentCount = 0;
      if (aiResponse.action === 'send_media' && aiResponse.mediaName) {
        mediaSentCount = await this.sendMediaMessages(tenantId, phone, conversation.id, tenantToken, instanceConfig, aiResponse.mediaName);
      }

      // Envia a mensagem final UMA VEZ antes de silenciar
      if (aiResponse.reply) {
        if (mediaSentCount > 0) await new Promise(r => setTimeout(r, 500));
        this.logger.log(`📤 [SHOULDIGNORE] Enviando ${aiResponse.reply.substring(0, 40)}...`);
        await this.evolutionService.sendTextMessage(phone, aiResponse.reply, tenantToken);
        await this.leadsService.saveMessage(conversation.id, 'outbound', 'ai', aiResponse.reply);
      }

      // Aplica etiquetas na uazapi e salva no banco
      const tags = aiResponse.tags ?? [];
      if (tags.length > 0) {
        await this.applyTagsToLead(phone, tags, tenantId);
        const existingLabels: string[] = lead.labels ?? [];
        const mergedLabels = Array.from(new Set([...existingLabels, ...tags]));
        await this.leadsService.update(lead.id, { labels: mergedLabels } as any);
      }

      // Atualiza stage e desativa IA permanentemente para nunca mais responder
      if (aiResponse.stage) {
        await this.leadsService.updateStage(lead.id, aiResponse.stage as any, 'ai');
      }
      await this.leadsService.toggleAi(lead.id, false);

      const updatedLead = await this.leadsService.findOne(lead.id);
      this.leadsGateway.emitLeadUpdated(updatedLead);
      return;
    }

    // Atualiza contexto e campos do lead
    const updatedContext = aiResponse.success
      ? this.aiService.buildUpdatedContext(lead, combinedText, aiResponse.rawJson!)
      : lead.aiContext;
    const updateData: any = { aiContext: updatedContext };

    if (aiResponse.temperature) updateData.temperature = aiResponse.temperature;
    if (aiResponse.fields) {
      const f = aiResponse.fields;
      if (f.name && f.name !== 'null') updateData.name = f.name;
      if (f.symptoms) updateData.symptoms = f.symptoms;
      if (f.urgency) updateData.urgency = f.urgency;
      if (f.availability) updateData.availability = f.availability;
      if (f.budget) updateData.budget = f.budget;
      if (f.qualificationScore !== undefined) updateData.qualificationScore = f.qualificationScore;
      if (f.qualificationStep !== undefined) updateData.qualificationStep = f.qualificationStep;
    }

    // Score definido pelo stage (IA não retorna score confiável)
    if (aiResponse.stage) {
      const stageScore: Record<string, number> = {
        novo_lead: 0, lead_frio: 20, lead_quente: 75, agendado: 90, vendas: 100, desliza_hair: 100, perdido: 5,
      };
      if (stageScore[aiResponse.stage] !== undefined) {
        updateData.qualificationScore = stageScore[aiResponse.stage];
      }
    }

    await this.leadsService.update(lead.id, updateData);

    // Aplica tags para respostas normais (sem shouldIgnore)
    const normalTags = (aiResponse.tags ?? []).filter(t => t);
    if (normalTags.length > 0) {
      const existingLabels: string[] = lead.labels ?? [];
      const newTags = normalTags.filter(t => !existingLabels.includes(t));
      if (newTags.length > 0) {
        await this.applyTagsToLead(phone, newTags, tenantId);
        const mergedLabels = Array.from(new Set([...existingLabels, ...newTags]));
        await this.leadsService.update(lead.id, { labels: mergedLabels } as any);
      }
    }

    // Salva histórico se o stage mudou — com proteção contra regressão
    if (aiResponse.stage && aiResponse.stage !== lead.stage) {
      const stageOrder: Record<string, number> = {
        novo_lead: 0, lead_frio: 1, lead_quente: 2,
        agendado: 3, vendas: 4, desliza_hair: 5, perdido: 4,
      };
      const currentOrder = stageOrder[lead.stage] ?? 0;
      const newOrder = stageOrder[aiResponse.stage] ?? 0;
      const canRegress = ['lead_frio', 'perdido'].includes(aiResponse.stage);

      if (newOrder >= currentOrder || canRegress) {
        await this.leadsService.updateStage(lead.id, aiResponse.stage as any, 'ai');
      } else {
        this.logger.warn(`Stage regressivo bloqueado: ${lead.stage} → ${aiResponse.stage}`);
      }
    }

    // Envio de mídia (imagem/vídeo cadastrada no sistema).
    // mediaName pode ser string (1 vídeo) ou array (vários — ex: "todos os lisos").
    if (aiResponse.action === 'send_media' && aiResponse.mediaName) {
      const sentCount = await this.sendMediaMessages(tenantId, phone, conversation.id, tenantToken, instanceConfig, aiResponse.mediaName);

      if (sentCount > 0) {
        // Envia o reply após todos os vídeos (com pequeno delay pra parecer natural).
        if (aiResponse.reply?.trim()) {
          await new Promise(r => setTimeout(r, 500));
          this.logger.log(`📤 [TEXT REPLY] Enviando resposta após mídias para ${phone}: ${aiResponse.reply.substring(0, 60)}...`);
          await this.evolutionService.sendTextMessage(phone, aiResponse.reply, tenantToken);
          await this.leadsService.saveMessage(conversation.id, 'outbound', 'ai', aiResponse.reply);
          this.logger.log(`✅ [TEXT REPLY] Resposta enviada para ${phone}`);
        }
        const updatedLead = await this.leadsService.findOne(lead.id);
        this.leadsGateway.emitLeadUpdated(updatedLead);
        return;
      }
      // Nenhuma mídia encontrada → cai pro envio de texto normal (reply da IA).
    }

    this.lastMessageWasAudio.delete(`${tenantId}:${phone}`);

    // Resposta sempre em texto (mesmo quando a mensagem do lead foi áudio).
    this.logger.log(`📤 [TEXT] Enviando resposta para ${phone}: ${aiResponse.reply.substring(0, 60)}...`);
    await this.evolutionService.sendTextMessage(phone, aiResponse.reply, tenantToken);
    this.logger.log(`✅ [TEXT] Resposta enviada para ${phone}`);

    await this.leadsService.saveMessage(conversation.id, 'outbound', 'ai', aiResponse.reply);

    const updatedLead = await this.leadsService.findOne(lead.id);
    this.leadsGateway.emitLeadUpdated(updatedLead);
  }

  // Envia 1+ mídias cadastradas (respeitando o teto diário por tenant) e salva cada
  // uma como mensagem outbound. Extraído pra ser chamado tanto no fluxo normal quanto
  // no early-return de shouldIgnore (que antes descartava o envio de mídia — ver bug
  // do handoff de "tela" perdendo o vídeo quando a IA desliga na mesma resposta).
  private async sendMediaMessages(
    tenantId: string,
    phone: string,
    conversationId: string,
    tenantToken: string | undefined,
    instanceConfig: any,
    mediaNameInput: string | string[],
  ): Promise<number> {
    const DEFAULT_CAPTION = 'repare na ponta como ele é todo inteiro, o que acha?';
    const MAX_MEDIA = 12; // teto de segurança para evitar flood
    const names = (Array.isArray(mediaNameInput) ? mediaNameInput : [mediaNameInput])
      .filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
      .slice(0, MAX_MEDIA);

    // Limite diário de vídeos por tenant (BRT). Padrão: 100.
    const dailyLimit = instanceConfig?.mediaLimitPerDay ?? 100;
    const alreadySentToday = await this.leadsService.countTodayOutboundMedia(tenantId);
    const remainingQuota = Math.max(0, dailyLimit - alreadySentToday);

    // Notifica o cliente via WhatsApp UMA VEZ por dia ao atingir o limite
    if (remainingQuota === 0) {
      const todayBRT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
      const lastNotified = this.mediaLimitNotifiedDate.get(tenantId);
      if (lastNotified !== todayBRT && instanceConfig?.billingPhone) {
        this.mediaLimitNotifiedDate.set(tenantId, todayBRT);
        // Usa BILLING_SENDER_TOKEN se configurado, senão cai no token do próprio tenant
        const billingToken = this.configService.get<string>('BILLING_SENDER_TOKEN') || tenantToken;
        const baseUrl = this.configService.get<string>('UAZAPI_BASE_URL') ?? '';
        const tenantName = instanceConfig.displayName ?? 'seu negócio';
        const alertMsg = `⚠️ *Limite diário de vídeos atingido!*\n\nOlá! O assistente virtual de *${tenantName}* atingiu o limite de *${dailyLimit} vídeos* enviados hoje.\n\nOs próximos pedidos de vídeo receberão apenas a descrição em texto. O envio volta automaticamente amanhã. 🎬\n\nEm caso de dúvidas, entre em contato com o suporte.`;
        try {
          await axios.post(`${baseUrl}/send/text`, { number: instanceConfig.billingPhone, text: alertMsg }, { headers: { token: billingToken } });
          this.logger.warn(`[MEDIA-LIMIT] Notificação enviada para ${instanceConfig.billingPhone} (tenant ${tenantId})`);
        } catch (err) {
          this.logger.error(`[MEDIA-LIMIT] Falha ao notificar ${instanceConfig.billingPhone}: ${err.message}`);
        }
      }
    }

    let sentCount = 0;
    for (let i = 0; i < names.length; i++) {
      if (sentCount >= remainingQuota) {
        this.logger.warn(`[MEDIA-LIMIT] Limite diário de ${dailyLimit} vídeos atingido para tenant ${tenantId} — pulando envio`);
        break;
      }
      const mediaFile = await this.mediaService.findByName(names[i], tenantId);
      if (!mediaFile) {
        this.logger.warn(`Mídia "${names[i]}" não encontrada no banco`);
        continue;
      }
      const type = mediaFile.mimeType?.startsWith('video/') ? 'video' : 'image';
      // Legenda configurável por vídeo (MediaPage). Sem legenda cadastrada → usa padrão.
      const caption = mediaFile.caption?.trim() || DEFAULT_CAPTION;
      await this.uazapiProvider.sendMediaByUrl(phone, mediaFile.url, type, caption, tenantToken);
      await this.leadsService.saveMessage(conversationId, 'outbound', 'ai', `[mídia: ${mediaFile.name}] ${caption}`);
      sentCount++;
      // Pequeno intervalo entre vídeos — evita rate limit do WhatsApp e parece mais natural.
      if (i < names.length - 1) await new Promise(r => setTimeout(r, 300));
    }

    return sentCount;
  }

  // Verificação de webhook exigida pela Meta
  @Get('whatsapp')
  handleMetaVerification(@Query() query: any, @Res() res: Response) {
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    if (mode === 'subscribe' && token === this.configService.get('WHATSAPP_VERIFY_TOKEN')) {
      this.logger.log('Webhook Meta verificado com sucesso');
      return res.status(200).send(challenge);
    }

    this.logger.warn('Falha na verificação do webhook Meta — token inválido');
    return res.status(403).send('Forbidden');
  }

  @Post('whatsapp')
  async handleMetaWebhook(@Body() body: any) {
    if (body.object !== 'whatsapp_business_account') return { ok: true };

    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const messages: any[] = value?.messages ?? [];

    for (const message of messages) {
      if (message.type === 'reaction') continue;

      const rawPhone: string = message.from ?? '';
      const phone = rawPhone.replace(/\D/g, '');
      if (!phone) continue;

      // Meta é instância única — usa o tenant default (config mais recente).
      const metaConfig = await this.whatsappConfigService.get();
      const tenantId = metaConfig?.id ?? '';

      // Ignora mensagens antigas
      const ageSeconds = (Date.now() / 1000) - Number(message.timestamp);
      if (ageSeconds > 300) {
        this.logger.warn(`Mensagem Meta ignorada — muito antiga (${Math.round(ageSeconds)}s): ${phone}`);
        continue;
      }

      // Deduplicação
      const messageId: string = message.id;
      if (this.processedIds.has(messageId)) {
        this.logger.warn(`Webhook Meta duplicado ignorado: ${messageId}`);
        continue;
      }
      this.processedIds.add(messageId);
      setTimeout(() => this.processedIds.delete(messageId), 5 * 60 * 1000);

      const isAudio = message.type === 'audio';
      this.lastMessageWasAudio.set(`${tenantId}:${phone}`, isAudio);

      if (isAudio) {
        const mediaId: string = message.audio?.id;
        if (!mediaId) continue;
        this.transcribeAndEnqueueMeta(tenantId, phone, mediaId, messageId).catch((err) =>
          this.logger.error(`Erro ao transcrever áudio Meta de ${phone}: ${err.message}`),
        );
        continue;
      }

      const text: string = message.text?.body ?? '';
      if (!text) continue;

      this.logger.log(`Mensagem Meta recebida de ${phone}: ${text}`);
      this.messageQueue.enqueue(`${tenantId}:${phone}`, text, (combinedText) => {
        this.processMessage(tenantId, phone, combinedText, messageId).catch((err) =>
          this.logger.error(`Erro ao processar mensagem Meta de ${phone}: ${err.message}`),
        );
      });
    }

    return { ok: true };
  }

  private async transcribeAndEnqueueMeta(tenantId: string, phone: string, mediaId: string, messageId: string) {
    this.logger.log(`Transcrevendo áudio Meta de ${phone}...`);
    const transcribedText = await this.evolutionService.transcribeAudio(mediaId);
    this.logger.log(`Áudio Meta transcrito de ${phone}: "${transcribedText}"`);

    this.messageQueue.enqueue(`${tenantId}:${phone}`, transcribedText, (combinedText) => {
      this.processMessage(tenantId, phone, combinedText, messageId).catch((err) =>
        this.logger.error(`Erro ao processar áudio Meta de ${phone}: ${err.message}`),
      );
    });
  }

  @UseGuards(JwtAuthGuard)
  @Post('manual')
  async sendManual(@Body() body: { phone: string; text: string }, @CurrentUser('tenantId') tenantId: string) {
    const { lead, conversation } = await this.leadsService.findOrCreate(body.phone, tenantId);
    const tenantToken = await this.whatsappConfigService.getTokenByTenant(tenantId);
    this.logger.log(`📤 [MANUAL] Enviando para ${body.phone}: ${body.text.substring(0, 50)}...`);
    await this.evolutionService.sendTextMessage(body.phone, body.text, tenantToken);
    await this.leadsService.saveMessage(conversation.id, 'outbound', 'operator', body.text);
    await this.leadsService.update(lead.id, { lastMessageAt: new Date() }, tenantId);
    const updatedLead = await this.leadsService.findOne(lead.id, tenantId);
    this.leadsGateway.emitLeadUpdated(updatedLead);
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Post('manual-media')
  async sendManualMedia(@Body() body: { phone: string; mediaId: string; caption?: string }, @CurrentUser('tenantId') tenantId: string) {
    const media = await this.mediaService.findById(body.mediaId, tenantId);
    if (!media) throw new Error('Mídia não encontrada');
    const { lead, conversation } = await this.leadsService.findOrCreate(body.phone, tenantId);
    const tenantToken = await this.whatsappConfigService.getTokenByTenant(tenantId);
    const type = media.mimeType?.startsWith('video/') ? 'video' : 'image';
    this.logger.log(`📤 [MANUAL-MEDIA] Enviando ${type} "${media.name}" para ${body.phone}`);
    await this.uazapiProvider.sendMediaByUrl(body.phone, media.url, type, body.caption ?? '', tenantToken);
    const logMsg = `[mídia: ${media.name}]${body.caption ? ' ' + body.caption : ''}`;
    await this.leadsService.saveMessage(conversation.id, 'outbound', 'operator', logMsg);
    await this.leadsService.update(lead.id, { lastMessageAt: new Date() }, tenantId);
    const updatedLead = await this.leadsService.findOne(lead.id, tenantId);
    this.leadsGateway.emitLeadUpdated(updatedLead);
    return { ok: true };
  }

  /**
   * Aplica etiquetas em um contato via uazapi:
   * 1. Busca etiquetas existentes (GET /labels)
   * 2. Cria as que não existem (POST /label/edit)
   * 3. Busca novamente para pegar IDs atualizados
   * 4. Associa cada etiqueta ao contato (POST /chat/labels com add_labelid)
   */
  private async applyTagsToLead(phone: string, tags: string[], tenantId?: string): Promise<void> {
    const uazapiUrl = this.configService.get('UAZAPI_BASE_URL') || 'https://labsai.uazapi.com';
    const uazapiToken = tenantId
      ? await this.whatsappConfigService.getTokenByTenant(tenantId)
      : await this.whatsappConfigService.getActiveToken();

    if (!uazapiToken) {
      this.logger.warn('Token uazapi não encontrado — etiquetas não aplicadas');
      return;
    }

    const headers = {
      token: uazapiToken,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    try {
      this.logger.log(`Aplicando etiquetas ao contato ${phone}: ${tags.join(', ')}`);

      // 1. Busca etiquetas existentes
      const labelsRes = await axios.get(`${uazapiUrl}/labels`, { headers });
      let existingLabels: Array<{ id: string; name: string }> = labelsRes.data || [];
      const existingByName = new Map(existingLabels.map((l) => [l.name.toLowerCase(), l.id]));

      // 2. Cria etiquetas que ainda não existem (cores: 1=verde, 2=amarelo, 3=azul, 4=vermelho, 5=roxo)
      const colorMap: Record<string, number> = {
        inativo: 4,            // vermelho
        desrespeitoso: 4,      // vermelho
        emergencia: 4,         // vermelho
        'fora-de-escopo': 3,   // azul
        qualificado: 5,        // verde
        'data-aproximada': 2,  // amarelo — agendamento sem data exata, operadora precisa confirmar depois
      };

      for (const tag of tags) {
        if (!existingByName.has(tag.toLowerCase())) {
          this.logger.log(`Criando etiqueta "${tag}"`);
          await axios.post(
            `${uazapiUrl}/label/edit`,
            { labelid: 'new', name: tag, color: colorMap[tag.toLowerCase()] ?? 1, delete: false },
            { headers },
          );
        }
      }

      // 3. Busca novamente para pegar IDs das recém-criadas
      const updatedRes = await axios.get(`${uazapiUrl}/labels`, { headers });
      existingLabels = updatedRes.data || [];
      const updatedByName = new Map(existingLabels.map((l) => [l.name.toLowerCase(), l.id]));

      // 4. Associa cada etiqueta ao contato individualmente
      for (const tag of tags) {
        const labelId = updatedByName.get(tag.toLowerCase());
        if (!labelId) {
          this.logger.warn(`Etiqueta "${tag}" não encontrada após criação`);
          continue;
        }

        await axios.post(
          `${uazapiUrl}/chat/labels`,
          { number: phone, add_labelid: labelId },
          { headers },
        );
        this.logger.log(`Etiqueta "${tag}" (id=${labelId}) aplicada ao contato ${phone}`);
      }
    } catch (err) {
      this.logger.error(`Erro ao aplicar etiquetas para ${phone}: ${err.message}`);
    }
  }

  private parseBrazilianDateTime(isoStr: string): Date {
    const cleaned = isoStr.replace(/(\.\d+)?([Z]|[+-]\d{2}:?\d{2})?$/, '');
    return new Date(`${cleaned}-03:00`);
  }
}
