import { Controller, Post, Body, Logger } from '@nestjs/common';
import { EvolutionService } from './evolution.service';
import { LeadsService } from '../leads/leads.service';
import { AiService } from '../ai/ai.service';

@Controller('webhooks')
export class EvolutionController {
  private readonly logger = new Logger(EvolutionController.name);

  constructor(
    private readonly evolutionService: EvolutionService,
    private readonly leadsService: LeadsService,
    private readonly aiService: AiService,
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

    // Atualiza contexto e campos do lead
    const updatedContext = this.aiService.buildUpdatedContext(lead, text, aiResponse.reply);
    const updateData: any = { aiContext: updatedContext };

    if (aiResponse.stage) updateData.stage = aiResponse.stage;
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

    await this.evolutionService.sendTextMessage(phone, aiResponse.reply);
    await this.leadsService.saveMessage(conversation.id, 'outbound', 'ai', aiResponse.reply);

    return { ok: true };
  }
}
