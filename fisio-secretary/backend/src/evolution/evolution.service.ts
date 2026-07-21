import { Inject, Injectable } from '@nestjs/common';
import type { IWhatsAppProvider } from './providers/whatsapp-provider.interface';

@Injectable()
export class EvolutionService {
  constructor(
    @Inject('WHATSAPP_PROVIDER') private readonly provider: IWhatsAppProvider,
  ) {}

  // Suporte a "bolhas": se o prompt do agente marcar quebras com "|||" (resposta
  // longa demais pra 1 mensagem só), envia como várias mensagens WhatsApp em
  // sequência (máx. 3), com indicador de "digitando..." + delay maior entre elas —
  // mais natural que 1 texto gigante. Sem "|||" no texto, comportamento idêntico
  // ao de sempre (1 chamada, sem delay).
  async sendTextMessage(phone: string, text: string, token?: string): Promise<void> {
    if (!text?.includes('|||')) {
      return this.provider.sendTextMessage(phone, text, token);
    }
    const bubbles = text.split('|||').map(b => b.trim()).filter(Boolean).slice(0, 3);
    for (let i = 0; i < bubbles.length; i++) {
      if (i > 0) {
        await this.provider.sendTypingIndicator(phone, 2500, token);
        await new Promise(r => setTimeout(r, 2500));
      }
      await this.provider.sendTextMessage(phone, bubbles[i], token);
    }
  }

  sendAudioMessage(phone: string, buffer: Buffer, token?: string): Promise<void> {
    return this.provider.sendAudioMessage(phone, buffer, token);
  }

  sendTypingIndicator(phone: string, durationMs?: number, token?: string): Promise<void> {
    return this.provider.sendTypingIndicator(phone, durationMs, token);
  }

  transcribeAudio(mediaId: string, token?: string): Promise<string> {
    return this.provider.transcribeAudio(mediaId, token);
  }
}
