import { Controller, Post, Body, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { EfraimService } from './efraim.service';
import { LeadsService } from '../leads/leads.service';
import { WaStage } from '../common/entities/lead.entity';

@Controller('webhooks')
export class EfraimController {
  private readonly logger = new Logger(EfraimController.name);
  private readonly processedIds = new Set<string>();
  private readonly messageQueues = new Map<string, Promise<void>>();
  private readonly uazapiBaseUrl: string;
  private readonly uazapiToken: string;

  constructor(
    private readonly efraimService: EfraimService,
    private readonly leadsService: LeadsService,
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    this.uazapiBaseUrl = config.get('UAZAPI_BASE_URL') || 'https://free.uazapi.com';
    this.uazapiToken = config.get('UAZAPI_TOKEN') || '';
  }

  @Post('whatsapp')
  async handleWhatsAppWebhook(@Body() body: any) {
    // Formato uazapi
    if (body.EventType !== 'messages') return { ok: true };

    const message = body.message;
    if (!message) return { ok: true };

    // Ignora mensagens enviadas pelo bot, grupos ou duplicadas
    if (message.fromMe || message.isGroup || message.wasSentByApi) return { ok: true };

    const phone: string = (body.chat?.phone ?? '').replace(/\D/g, '');
    const text: string = message.text ?? '';
    const messageId: string = message.messageid ?? '';

    if (!phone || !text) return { ok: true };

    // Ignora mensagens antigas (> 5 min)
    if (message.messageTimestamp) {
      const ageSeconds = (Date.now() - message.messageTimestamp) / 1000;
      if (ageSeconds > 300) {
        this.logger.warn(`Mensagem ignorada — antiga (${Math.round(ageSeconds)}s): ${phone}`);
        return { ok: true };
      }
    }

    // Deduplicação
    if (this.processedIds.has(messageId)) {
      this.logger.warn(`Webhook duplicado ignorado: ${messageId}`);
      return { ok: true };
    }
    this.processedIds.add(messageId);
    setTimeout(() => this.processedIds.delete(messageId), 5 * 60 * 1000);

    this.logger.log(`Mensagem recebida de ${phone}: "${text}"`);

    // Message queue por phone (evita race conditions)
    const current = this.messageQueues.get(phone) ?? Promise.resolve();
    const next = current.then(() =>
      this.processMessage(phone, text).catch((err) =>
        this.logger.error(`Erro ao processar mensagem de ${phone}: ${err.message}`),
      ),
    );
    this.messageQueues.set(phone, next);
    next.finally(() => {
      if (this.messageQueues.get(phone) === next) {
        this.messageQueues.delete(phone);
      }
    });

    return { ok: true };
  }

  private async processMessage(phone: string, text: string) {
    const lead = await this.leadsService.findByPhone(phone);
    if (!lead) {
      this.logger.warn(`Nenhum lead encontrado para phone ${phone}`);
      return;
    }

    // Define stage inicial se for a primeira resposta
    if (!lead.waStage) {
      await this.leadsService.update(lead.id, { waStage: 'abertura' as WaStage });
      lead.waStage = 'abertura';
    }

    // Não processa se já confirmado ou perdido
    if (lead.waStage === 'confirmado' || lead.waStage === 'perdido') {
      this.logger.log(`Lead ${phone} em stage "${lead.waStage}" — sem resposta automática`);
      return;
    }

    // Mostra "digitando..." por 2s antes de responder
    await this.sendTyping(phone, 2000);

    // Processa com IA
    const aiResponse = await this.efraimService.processMessage(lead, text);

    // Atualiza contexto e stage no lead
    const updatedContext = this.efraimService.buildUpdatedContext(lead, text, aiResponse.reply);
    await this.leadsService.update(lead.id, {
      aiContext: updatedContext,
      waStage: aiResponse.stage,
      waLastMessageAt: new Date(),
    });

    // Envia resposta via uazapi
    await this.sendMessage(phone, aiResponse.reply);
  }

  private async sendMessage(phone: string, text: string) {
    try {
      const normalizedPhone = phone.startsWith('55') ? phone : `55${phone}`;
      await firstValueFrom(
        this.http.post(
          `${this.uazapiBaseUrl}/send/text`,
          { number: normalizedPhone, text },
          { headers: { token: this.uazapiToken } },
        ),
      );
      this.logger.log(`Efraim respondeu para ${phone}`);
    } catch (err: any) {
      this.logger.error(`Erro ao enviar resposta para ${phone}: ${err.message}`);
    }
  }

  private async sendTyping(phone: string, durationMs: number) {
    try {
      const normalizedPhone = phone.startsWith('55') ? phone : `55${phone}`;
      await firstValueFrom(
        this.http.post(
          `${this.uazapiBaseUrl}/message/presence`,
          { number: normalizedPhone, presence: 'composing', delay: durationMs },
          { headers: { token: this.uazapiToken } },
        ),
      );
    } catch {
      // Não crítico, ignora erro de typing indicator
    }
  }
}
