import { Controller, Post, Body, Logger } from '@nestjs/common';
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
  ) {}

  @Post('evolution')
  async handleWebhook(@Body() body: any) {
    if (body.event !== 'messages.upsert') return { ok: true };

    const message = body.data;
    if (!message?.key || message.key.fromMe) return { ok: true };

    const remoteJid = message.key.remoteJid ?? '';
    if (remoteJid.includes('@g.us')) return { ok: true };
    const phone = remoteJid.replace('@s.whatsapp.net', '').replace('@lid', '');

    const text = message.message?.conversation || message.message?.extendedTextMessage?.text;
    const isAudio = !!message.message?.audioMessage;

    if (!phone || (!text && !isAudio)) return { ok: true };

    // Ignora mensagens antigas (backend estava fora do ar)
    const messageTimestamp = message.messageTimestamp;
    if (messageTimestamp) {
      const msgDate = new Date(messageTimestamp * 1000);
      const ageSeconds = (Date.now() - msgDate.getTime()) / 1000;
      if (ageSeconds > 300) {
        this.logger.warn(`Mensagem ignorada — muito antiga (${Math.round(ageSeconds)}s): ${phone}`);
        return { ok: true };
      }
    }

    // Ignora webhook duplicado para a mesma mensagem
    const messageId = message.key.id;
    if (this.processedIds.has(messageId)) {
      this.logger.warn(`Webhook duplicado ignorado: ${messageId}`);
      return { ok: true };
    }
    this.processedIds.add(messageId);
    setTimeout(() => this.processedIds.delete(messageId), 5 * 60 * 1000);

    // Rastreia tipo da última mensagem para definir formato da resposta
    this.lastMessageWasAudio.set(phone, isAudio);

    if (isAudio) {
      // Transcreve o áudio de forma assíncrona e enfileira o texto resultante
      this.transcribeAndEnqueue(phone, message, messageId).catch((err) =>
        this.logger.error(`Erro ao transcrever áudio de ${phone}: ${err.message}`),
      );
      return { ok: true };
    }

    this.logger.log(`Mensagem recebida de ${phone}: ${text}`);

    // Enfileira e retorna imediatamente — processamento acontece no callback após debounce
    this.messageQueue.enqueue(phone, text!, (combinedText) => {
      this.processMessage(phone, combinedText, messageId).catch((err) =>
        this.logger.error(`Erro ao processar mensagem de ${phone}: ${err.message}`),
      );
    });

    return { ok: true };
  }

  private async transcribeAndEnqueue(phone: string, message: any, messageId: string) {
    this.logger.log(`Transcrevendo áudio de ${phone}...`);
    const { base64 } = await this.evolutionService.getBase64FromMedia(message);
    const transcribedText = await this.audioService.transcribe(base64);
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

      const eventId = await this.calendarService.createAppointment({
        leadName: lead.name || lead.phone,
        phone: lead.phone,
        symptoms: lead.symptoms || '',
        startDateTime,
      });

      if (eventId) {
        await this.leadsService.update(lead.id, { calendarEventId: eventId, appointmentAt: startDateTime });
      }
    }

    if (action === 'cancel' && lead.calendarEventId) {
      await this.calendarService.cancelAppointment(lead.calendarEventId);
      await this.leadsService.update(lead.id, { calendarEventId: null, appointmentAt: null });
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
        const eventId = await this.calendarService.createAppointment({
          leadName: lead.name || lead.phone,
          phone: lead.phone,
          symptoms: lead.symptoms || '',
          startDateTime: newDateTime,
        });
        if (eventId) {
          await this.leadsService.update(lead.id, { calendarEventId: eventId, appointmentAt: newDateTime });
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
