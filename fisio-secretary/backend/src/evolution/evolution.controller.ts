import { Controller, Post, Body, Logger } from '@nestjs/common';
import { EvolutionService } from './evolution.service';
import { LeadsService } from '../leads/leads.service';
import { AiService } from '../ai/ai.service';
import { LeadsGateway } from '../leads/leads.gateway';
import { CalendarService } from '../calendar/calendar.service';

@Controller('webhooks')
export class EvolutionController {
  private readonly logger = new Logger(EvolutionController.name);

  constructor(
    private readonly evolutionService: EvolutionService,
    private readonly leadsService: LeadsService,
    private readonly aiService: AiService,
    private readonly leadsGateway: LeadsGateway,
    private readonly calendarService: CalendarService,
  ) {}

  @Post('evolution')
  async handleWebhook(@Body() body: any) {
    if (body.event !== 'messages.upsert') return { ok: true };

    const message = body.data;
    if (!message?.key || message.key.fromMe) return { ok: true };

    const remoteJid = message.key.remoteJid ?? '';
    if (remoteJid.includes('@g.us')) return { ok: true }; // ignora grupos
    const phone = remoteJid.replace('@s.whatsapp.net', '').replace('@lid', '');

    const text = message.message?.conversation || message.message?.extendedTextMessage?.text;
    if (!phone || !text) return { ok: true };

    this.logger.log(`Mensagem recebida de ${phone}: ${text}`);

    const { lead, conversation } = await this.leadsService.findOrCreate(phone);

    await this.leadsService.saveMessage(conversation.id, 'inbound', phone, text, message.key.id);
    await this.leadsService.update(lead.id, { lastMessageAt: new Date() });

    // Processa com IA
    const aiResponse = await this.aiService.processMessage(lead, text);
    this.logger.log(`IA respondeu [stage=${aiResponse.stage}]: ${aiResponse.reply}`);

    // Atualiza contexto e campos do lead (só salva contexto se a IA respondeu com sucesso)
    const updatedContext = aiResponse.success
      ? this.aiService.buildUpdatedContext(lead, text, aiResponse.reply)
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
        // Horário ocupado — informa a IA para oferecer alternativa
        this.logger.warn(`Horário ocupado: ${startDateTime.toISOString()} (${conflictingEvent})`);
        const busyReply = `Ops! Esse horário já está ocupado (${conflictingEvent}). Por favor, escolha outro horário ou dia 😊`;
        await this.evolutionService.sendTextMessage(phone, busyReply);
        await this.leadsService.saveMessage(conversation.id, 'outbound', 'ai', busyReply);
        const updatedLead = await this.leadsService.findOne(lead.id);
        this.leadsGateway.emitLeadUpdated(updatedLead);
        return { ok: true };
      }

      const eventId = await this.calendarService.createAppointment({
        leadName: lead.name || lead.phone,
        phone: lead.phone,
        symptoms: lead.symptoms || '',
        startDateTime,
      });

      if (eventId) {
        await this.leadsService.update(lead.id, {
          calendarEventId: eventId,
          appointmentAt: startDateTime,
        });
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
        return { ok: true };
      }

      if (lead.calendarEventId) {
        // Atualiza evento existente
        await this.calendarService.updateAppointment(lead.calendarEventId, newDateTime);
        await this.leadsService.update(lead.id, { appointmentAt: newDateTime });
      } else {
        // Sem evento anterior (primeiro horário foi bloqueado) — cria novo
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

    await this.evolutionService.sendTextMessage(phone, aiResponse.reply);
    await this.leadsService.saveMessage(conversation.id, 'outbound', 'ai', aiResponse.reply);

    const updatedLead = await this.leadsService.findOne(lead.id);
    this.leadsGateway.emitLeadUpdated(updatedLead);

    return { ok: true };
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
