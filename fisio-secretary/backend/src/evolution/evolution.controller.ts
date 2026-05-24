import { Controller, Post, Get, Body, Query, Res, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { EvolutionService } from './evolution.service';
import { MessageQueueService } from './message-queue.service';
import { WhatsappConfigService } from './whatsapp-config.service';
import { UazapiProvider } from './providers/uazapi.provider';
import { LeadsService } from '../leads/leads.service';
import { AiService } from '../ai/ai.service';
import { LeadsGateway } from '../leads/leads.gateway';
import { CalendarService } from '../calendar/calendar.service';
import { AudioService } from '../audio/audio.service';
import { MediaService } from '../media/media.service';
import { AppointmentsService } from '../appointments/appointments.service';

@Controller('webhooks')
export class EvolutionController {
  private readonly logger = new Logger(EvolutionController.name);
  private readonly processedIds = new Set<string>();
  // Rastreia se a última mensagem recebida de um phone foi áudio (para responder em áudio)
  private readonly lastMessageWasAudio = new Map<string, boolean>();

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
  ) {}

  @Post('uazapi')
  async handleUazapiWebhook(@Body() body: any) {
    if (body.EventType !== 'messages') return { ok: true };

    const message = body.message;
    if (!message || message.isGroup) return { ok: true };

    const rawPhone: string = body.chat?.phone ?? '';
    const phone = rawPhone.replace(/\D/g, '');

    // Mensagem enviada pelo próprio operador via WhatsApp (celular/Web), não pela API:
    // - "opa" desativa a IA daquele lead
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
        const { lead, conversation } = await this.leadsService.findOrCreate(phone);

        if (operatorText.toLowerCase() === 'opa') {
          await this.leadsService.toggleAi(lead.id, false);
          this.logger.log(`🛑 [OPA] Operador assumiu conversa de ${phone} via WhatsApp — IA desativada`);
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

    const text: string = message.text;
    const isAudio = message.type === 'media' && ['audio', 'ptt', 'myaudio'].includes(message.mediaType);
    const isImage = message.type === 'media' && message.mediaType === 'image';
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
        const { lead, conversation } = await this.leadsService.findOrCreate(phone, pushName);
        await this.leadsService.saveMessage(conversation.id, 'inbound', phone, '[imagem]', messageId);

        const instanceConfig = await this.whatsappConfigService.get();
        const agentType = instanceConfig?.agentType ?? 'fisio';

        if (agentType === 'megahair') {
          const reply = 'oi! ainda não consigo ver imagens por aqui 😅 vc pode me dizer se o cabelo é liso, ondulado ou cacheado?';
          await this.evolutionService.sendTextMessage(phone, reply);
          await this.leadsService.saveMessage(conversation.id, 'outbound', 'ai', reply);
        }

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

    this.lastMessageWasAudio.set(phone, isAudio);

    if (isAudio) {
      this.transcribeAndEnqueue(phone, message, messageId, pushName).catch((err) =>
        this.logger.error(`Erro ao transcrever áudio de ${phone}: ${err.message}`),
      );
      return { ok: true };
    }

    this.logger.log(`Mensagem recebida de ${phone}${pushName ? ` (${pushName})` : ''}: ${text}`);

    this.messageQueue.enqueue(phone, text, (combinedText) => {
      this.logger.log(`[PROCESSANDO] messageId=${messageId}, phone=${phone}, texto="${combinedText.substring(0, 40)}..."`);
      this.processMessage(phone, combinedText, messageId, pushName).catch((err) => {
        this.logger.error(`❌ [ERRO AO PROCESSAR] ${phone}: ${err.message}`);
        this.logger.error(`❌ [ERRO AO PROCESSAR] Stack: ${err.stack}`);
      });
    });

    return { ok: true };
  }

  private async transcribeAndEnqueue(phone: string, message: any, messageId: string, pushName?: string | null) {
    this.logger.log(`Transcrevendo áudio de ${phone}...`);
    const transcribedText = await this.evolutionService.transcribeAudio(message.messageid);
    this.logger.log(`Áudio transcrito de ${phone}: "${transcribedText}"`);

    this.messageQueue.enqueue(phone, transcribedText, (combinedText) => {
      this.processMessage(phone, combinedText, messageId, pushName).catch((err) =>
        this.logger.error(`Erro ao processar áudio transcrito de ${phone}: ${err.message}`),
      );
    });
  }

  private async processMessage(phone: string, combinedText: string, messageKeyId: string, pushName?: string | null) {
    const { lead, conversation } = await this.leadsService.findOrCreate(phone, pushName);

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

    // Lead perdido voltou a falar (sem estar desativado): reinicia como lead_frio
    if (lead.stage === 'perdido') {
      await this.leadsService.updateStage(lead.id, 'lead_frio' as any, 'system');
      lead.stage = 'lead_frio' as any;
      this.logger.log(`Lead ${phone} era perdido — movido para lead_frio ao retornar`);
    }

    // Mostra "digitando..." enquanto a IA processa
    void this.evolutionService.sendTypingIndicator(phone, 5000);

    // Processa com IA — roteia pelo agentType da instância ativa
    const instanceConfig = await this.whatsappConfigService.get();
    const agentType = instanceConfig?.agentType ?? 'fisio';

    let aiResponse;
    if (agentType === 'megahair') {
      const allMedia = await this.mediaService.listAll();
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

      aiResponse = await this.aiService.processMessageMegaHair(lead, combinedText, mediaNames, instanceConfig?.customPromptMegaHair ?? undefined, extraSystemContext);
    } else {
      aiResponse = await this.aiService.processMessage(lead, combinedText, instanceConfig?.customPromptSofia ?? undefined);
    }
    this.logger.log(`IA respondeu [agent=${agentType}] [stage=${aiResponse.stage}] [action=${aiResponse.action}] [tags=${JSON.stringify(aiResponse.tags ?? [])}]: ${aiResponse.reply}`);

    // CAMADA DE SEGURANÇA: Se shouldIgnore=true, não responder e sair
    if (aiResponse.shouldIgnore === true) {
      this.logger.warn(`Lead ${phone} marcado para ignorar. Aplicando etiquetas e não respondendo mais.`);

      // Envia a mensagem final UMA VEZ antes de silenciar
      if (aiResponse.reply) {
        this.logger.log(`📤 [SHOULDIGNORE] Enviando ${aiResponse.reply.substring(0, 40)}...`);
        await this.evolutionService.sendTextMessage(phone, aiResponse.reply);
        await this.leadsService.saveMessage(conversation.id, 'outbound', 'ai', aiResponse.reply);
      }

      // Aplica etiquetas na uazapi e salva no banco
      const tags = aiResponse.tags ?? [];
      if (tags.length > 0) {
        await this.applyTagsToLead(phone, tags);
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

    // MegaHair: score definido pelo stage (IA não retorna score confiável)
    if (agentType === 'megahair' && aiResponse.stage) {
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
        await this.applyTagsToLead(phone, newTags);
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

    // Ações de calendário
    const action = aiResponse.action;

    // MegaHair: agendamento interno (tabela appointments) — não usa Google Calendar
    if (agentType === 'megahair' && action === 'schedule' && aiResponse.appointmentDateTime) {
      try {
        const startDateTime = this.parseBrazilianDateTime(aiResponse.appointmentDateTime);
        // Cancela agendamento anterior do mesmo lead antes de criar o novo (reagendamento)
        const canceled = await this.appointmentsService.cancelActiveByLeadId(lead.id);
        if (canceled > 0) {
          this.logger.log(`📅 [MEGAHAIR] ${canceled} agendamento(s) anterior(es) cancelado(s) para ${lead.phone}`);
        }
        await this.appointmentsService.create({
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

    if (agentType !== 'megahair' && action === 'schedule' && aiResponse.appointmentDateTime) {
      const startDateTime = this.parseBrazilianDateTime(aiResponse.appointmentDateTime);
      const { available, conflictingEvent } = await this.calendarService.checkAvailability(startDateTime);

      if (!available) {
        this.logger.warn(`Horário ocupado: ${startDateTime.toISOString()} (${conflictingEvent})`);
        const busyReply = `Ops! Esse horário já está ocupado (${conflictingEvent}). Por favor, escolha outro horário ou dia 😊`;
        this.logger.log(`📤 [BUSY SLOT] Enviando: ${busyReply.substring(0, 40)}...`);
        await this.evolutionService.sendTextMessage(phone, busyReply);
        await this.leadsService.saveMessage(conversation.id, 'outbound', 'ai', busyReply);
        const updatedLead = await this.leadsService.findOne(lead.id);
        this.leadsGateway.emitLeadUpdated(updatedLead);
        return;
      }

      const event = await this.calendarService.createAppointment({
        leadName: lead.name || lead.phone,
        phone: lead.phone,
        symptoms: lead.symptoms || '',
        startDateTime,
      });

      if (event) {
        await this.leadsService.update(lead.id, { calendarEventId: event.id, calendarEventLink: event.htmlLink, appointmentAt: startDateTime });
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
        await this.evolutionService.sendTextMessage(phone, busyReply);
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

    // Envio de mídia (imagem/vídeo cadastrada no sistema)
    if (aiResponse.action === 'send_media' && aiResponse.mediaName) {
      const mediaFile = await this.mediaService.findByName(aiResponse.mediaName);
      if (mediaFile) {
        const type = mediaFile.mimeType?.startsWith('video/') ? 'video' : 'image';
        // Legenda fixa para mídia — não usa o reply da IA. Padroniza a apresentação do vídeo.
        const mediaCaption = 'repare na ponta como ele é todo inteiro, o que acha?';
        await this.uazapiProvider.sendMediaByUrl(phone, mediaFile.url, type, mediaCaption);
        await this.leadsService.saveMessage(conversation.id, 'outbound', 'ai', `[mídia: ${mediaFile.name}] ${mediaCaption}`);
        const updatedLead = await this.leadsService.findOne(lead.id);
        this.leadsGateway.emitLeadUpdated(updatedLead);
        return;
      } else {
        this.logger.warn(`Mídia "${aiResponse.mediaName}" não encontrada no banco`);
      }
    }

    this.lastMessageWasAudio.delete(phone);

    // Resposta sempre em texto (mesmo quando a mensagem do lead foi áudio).
    // Lógica de TTS comentada — pode ser reativada substituindo este bloco pelo if/else original.
    // const respondWithAudio = this.lastMessageWasAudio.get(phone) === true;
    // if (respondWithAudio) {
    //   try {
    //     const audioBuffer = await this.audioService.textToSpeech(aiResponse.reply);
    //     await this.evolutionService.sendAudioMessage(phone, audioBuffer);
    //   } catch (err) {
    //     await this.evolutionService.sendTextMessage(phone, aiResponse.reply);
    //   }
    // }
    this.logger.log(`📤 [TEXT] Enviando resposta para ${phone}: ${aiResponse.reply.substring(0, 60)}...`);
    await this.evolutionService.sendTextMessage(phone, aiResponse.reply);
    this.logger.log(`✅ [TEXT] Resposta enviada para ${phone}`);

    await this.leadsService.saveMessage(conversation.id, 'outbound', 'ai', aiResponse.reply);

    const updatedLead = await this.leadsService.findOne(lead.id);
    this.leadsGateway.emitLeadUpdated(updatedLead);
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
      this.lastMessageWasAudio.set(phone, isAudio);

      if (isAudio) {
        const mediaId: string = message.audio?.id;
        if (!mediaId) continue;
        this.transcribeAndEnqueueMeta(phone, mediaId, messageId).catch((err) =>
          this.logger.error(`Erro ao transcrever áudio Meta de ${phone}: ${err.message}`),
        );
        continue;
      }

      const text: string = message.text?.body ?? '';
      if (!text) continue;

      this.logger.log(`Mensagem Meta recebida de ${phone}: ${text}`);
      this.messageQueue.enqueue(phone, text, (combinedText) => {
        this.processMessage(phone, combinedText, messageId).catch((err) =>
          this.logger.error(`Erro ao processar mensagem Meta de ${phone}: ${err.message}`),
        );
      });
    }

    return { ok: true };
  }

  private async transcribeAndEnqueueMeta(phone: string, mediaId: string, messageId: string) {
    this.logger.log(`Transcrevendo áudio Meta de ${phone}...`);
    const transcribedText = await this.evolutionService.transcribeAudio(mediaId);
    this.logger.log(`Áudio Meta transcrito de ${phone}: "${transcribedText}"`);

    this.messageQueue.enqueue(phone, transcribedText, (combinedText) => {
      this.processMessage(phone, combinedText, messageId).catch((err) =>
        this.logger.error(`Erro ao processar áudio Meta de ${phone}: ${err.message}`),
      );
    });
  }

  @Post('manual')
  async sendManual(@Body() body: { phone: string; text: string }) {
    const { lead, conversation } = await this.leadsService.findOrCreate(body.phone);
    this.logger.log(`📤 [MANUAL] Enviando para ${body.phone}: ${body.text.substring(0, 50)}...`);
    await this.evolutionService.sendTextMessage(body.phone, body.text);
    await this.leadsService.saveMessage(conversation.id, 'outbound', 'operator', body.text);
    await this.leadsService.update(lead.id, { lastMessageAt: new Date() });
    const updatedLead = await this.leadsService.findOne(lead.id);
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
  private async applyTagsToLead(phone: string, tags: string[]): Promise<void> {
    const uazapiUrl = this.configService.get('UAZAPI_BASE_URL') || 'https://labsai.uazapi.com';
    const uazapiToken = await this.whatsappConfigService.getActiveToken();

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
