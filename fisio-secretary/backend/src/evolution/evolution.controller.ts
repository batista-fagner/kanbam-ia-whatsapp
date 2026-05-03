import { Controller, Post, Get, Body, Query, Res, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { EvolutionService } from './evolution.service';
import { MessageQueueService } from './message-queue.service';
import { LeadsService } from '../leads/leads.service';
import { AiService } from '../ai/ai.service';
import { LeadsGateway } from '../leads/leads.gateway';
import { CalendarService } from '../calendar/calendar.service';
import { AudioService } from '../audio/audio.service';

@Controller('webhooks')
export class EvolutionController {
  private readonly logger = new Logger(EvolutionController.name);
  private readonly processedIds = new Set<string>();
  // Rastreia se a última mensagem recebida de um phone foi áudio (para responder em áudio)
  private readonly lastMessageWasAudio = new Map<string, boolean>();

  constructor(
    private readonly evolutionService: EvolutionService,
    private readonly messageQueue: MessageQueueService,
    private readonly leadsService: LeadsService,
    private readonly aiService: AiService,
    private readonly leadsGateway: LeadsGateway,
    private readonly calendarService: CalendarService,
    private readonly audioService: AudioService,
    private readonly configService: ConfigService,
  ) {}

  @Post('uazapi')
  async handleUazapiWebhook(@Body() body: any) {
    if (body.EventType !== 'messages') return { ok: true };

    const message = body.message;
    if (!message || message.fromMe || message.isGroup || message.wasSentByApi) return { ok: true };

    const rawPhone: string = body.chat?.phone ?? '';
    const phone = rawPhone.replace(/\D/g, '');
    const text: string = message.text;
    const isAudio = message.type === 'media' && ['audio', 'ptt', 'myaudio'].includes(message.mediaType);

    if (!phone || (!text && !isAudio)) return { ok: true };

    if (!phone || (!text && !isAudio)) return { ok: true };

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
      this.transcribeAndEnqueue(phone, message, messageId).catch((err) =>
        this.logger.error(`Erro ao transcrever áudio de ${phone}: ${err.message}`),
      );
      return { ok: true };
    }

    this.logger.log(`Mensagem recebida de ${phone}: ${text}`);

    this.messageQueue.enqueue(phone, text, (combinedText) => {
      this.processMessage(phone, combinedText, messageId).catch((err) =>
        this.logger.error(`Erro ao processar mensagem de ${phone}: ${err.message}`),
      );
    });

    return { ok: true };
  }

  private async transcribeAndEnqueue(phone: string, message: any, messageId: string) {
    this.logger.log(`Transcrevendo áudio de ${phone}...`);
    const transcribedText = await this.evolutionService.transcribeAudio(message.messageid);
    this.logger.log(`Áudio transcrito de ${phone}: "${transcribedText}"`);

    this.messageQueue.enqueue(phone, transcribedText, (combinedText) => {
      this.processMessage(phone, combinedText, messageId).catch((err) =>
        this.logger.error(`Erro ao processar áudio transcrito de ${phone}: ${err.message}`),
      );
    });
  }

  private async processMessage(phone: string, combinedText: string, messageKeyId: string) {
    const { lead, conversation } = await this.leadsService.findOrCreate(phone);

    // Lead perdido voltou a falar: reinicia como lead_frio
    if (lead.stage === 'perdido') {
      await this.leadsService.updateStage(lead.id, 'lead_frio' as any, 'system');
      lead.stage = 'lead_frio' as any;
      this.logger.log(`Lead ${phone} era perdido — movido para lead_frio ao retornar`);
    }

    await this.leadsService.saveMessage(conversation.id, 'inbound', phone, combinedText, messageKeyId);
    await this.leadsService.update(lead.id, { lastMessageAt: new Date() });

    // Se IA desativada, apenas salva a mensagem e notifica o frontend
    const aiEnabled = await this.leadsService.getAiEnabled(lead.id);
    if (!aiEnabled) {
      this.logger.log(`IA desativada para ${phone} — mensagem salva, aguardando operador`);
      const updatedLead = await this.leadsService.findOne(lead.id);
      this.leadsGateway.emitLeadUpdated(updatedLead);
      return;
    }

    // Mostra "digitando..." enquanto a IA processa
    void this.evolutionService.sendTypingIndicator(phone, 5000);

    // Processa com IA
    const aiResponse = await this.aiService.processMessage(lead, combinedText);
    this.logger.log(`IA respondeu [stage=${aiResponse.stage}]: ${aiResponse.reply}`);

    // Atualiza contexto e campos do lead
    const updatedContext = aiResponse.success
      ? this.aiService.buildUpdatedContext(lead, combinedText, aiResponse.rawJson!)
      : lead.aiContext;
    const updateData: any = { aiContext: updatedContext };

    if (aiResponse.temperature) updateData.temperature = aiResponse.temperature;
    if (aiResponse.fields) {
      const f = aiResponse.fields;
      if (f.name) updateData.name = f.name;
      if (f.symptoms) updateData.symptoms = f.symptoms;
      if (f.urgency) updateData.urgency = f.urgency;
      if (f.availability) updateData.availability = f.availability;
      if (f.budget) updateData.budget = f.budget;
      if (f.qualificationScore !== undefined) updateData.qualificationScore = f.qualificationScore;
      if (f.qualificationStep !== undefined) updateData.qualificationStep = f.qualificationStep;
    }

    await this.leadsService.update(lead.id, updateData);

    // Salva histórico se o stage mudou — com proteção contra regressão
    if (aiResponse.stage && aiResponse.stage !== lead.stage) {
      const stageOrder: Record<string, number> = {
        novo_lead: 0, qualificando: 1, lead_quente: 2, lead_frio: 2,
        agendado: 3, convertido: 4, perdido: 4,
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

    if (action === 'schedule' && aiResponse.appointmentDateTime) {
      const startDateTime = new Date(aiResponse.appointmentDateTime);
      const { available, conflictingEvent } = await this.calendarService.checkAvailability(startDateTime);

      if (!available) {
        this.logger.warn(`Horário ocupado: ${startDateTime.toISOString()} (${conflictingEvent})`);
        const busyReply = `Ops! Esse horário já está ocupado (${conflictingEvent}). Por favor, escolha outro horário ou dia 😊`;
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
      const newDateTime = new Date(aiResponse.appointmentDateTime);
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

    const respondWithAudio = this.lastMessageWasAudio.get(phone) === true;
    this.lastMessageWasAudio.delete(phone);

    if (respondWithAudio) {
      try {
        this.logger.log(`Gerando TTS para ${phone}...`);
        const audioBuffer = await this.audioService.textToSpeech(aiResponse.reply);
        this.logger.log(`TTS gerado (${audioBuffer.length} bytes), enviando áudio para ${phone}...`);
        await this.evolutionService.sendAudioMessage(phone, audioBuffer);
        this.logger.log(`Resposta enviada como áudio para ${phone}`);
      } catch (err) {
        const status = err?.response?.status ?? err?.status ?? 'N/A';
        this.logger.warn(`Falha ao gerar/enviar áudio [HTTP ${status}], enviando como texto: ${err.message}`);
        await this.evolutionService.sendTextMessage(phone, aiResponse.reply);
      }
    } else {
      await this.evolutionService.sendTextMessage(phone, aiResponse.reply);
    }

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
    await this.evolutionService.sendTextMessage(body.phone, body.text);
    await this.leadsService.saveMessage(conversation.id, 'outbound', 'operator', body.text);
    await this.leadsService.update(lead.id, { lastMessageAt: new Date() });
    const updatedLead = await this.leadsService.findOne(lead.id);
    this.leadsGateway.emitLeadUpdated(updatedLead);
    return { ok: true };
  }
}
