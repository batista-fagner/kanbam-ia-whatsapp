import { Inject, Injectable } from '@nestjs/common';
import type { IWhatsAppProvider } from './providers/whatsapp-provider.interface';

// Typing indicator com duração dinâmica (proporcional ao tamanho do texto, como
// um humano digitando) — pedido pontual da demo de prospecção ativa
// (claudia_teste@hotmail.com). Nos demais tenants mantém o comportamento antigo
// (bolha fixa de 2500ms, sem indicador antes da 1ª bolha/mensagem única).
const DYNAMIC_TYPING_TENANT_IDS = ['1ff3f0b3-52d1-4e89-b7bf-552d0556de29'];

const TYPING_MS_PER_CHAR = 45;
const TYPING_MIN_MS = 1200;
const TYPING_MAX_MS = 6000;

function computeTypingDurationMs(text: string): number {
  const raw = (text?.length ?? 0) * TYPING_MS_PER_CHAR;
  return Math.min(TYPING_MAX_MS, Math.max(TYPING_MIN_MS, raw));
}

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
  async sendTextMessage(phone: string, text: string, token?: string, tenantId?: string): Promise<void> {
    const dynamicTyping = !!tenantId && DYNAMIC_TYPING_TENANT_IDS.includes(tenantId);

    if (!text?.includes('|||')) {
      if (dynamicTyping) {
        const duration = computeTypingDurationMs(text);
        await this.provider.sendTypingIndicator(phone, duration, token);
        await new Promise(r => setTimeout(r, duration));
      }
      return this.provider.sendTextMessage(phone, text, token);
    }
    const bubbles = text.split('|||').map(b => b.trim()).filter(Boolean).slice(0, 3);
    for (let i = 0; i < bubbles.length; i++) {
      if (dynamicTyping) {
        const duration = computeTypingDurationMs(bubbles[i]);
        await this.provider.sendTypingIndicator(phone, duration, token);
        await new Promise(r => setTimeout(r, duration));
      } else if (i > 0) {
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
