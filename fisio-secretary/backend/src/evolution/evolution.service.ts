import { Inject, Injectable } from '@nestjs/common';
import type { IWhatsAppProvider } from './providers/whatsapp-provider.interface';

@Injectable()
export class EvolutionService {
  constructor(
    @Inject('WHATSAPP_PROVIDER') private readonly provider: IWhatsAppProvider,
  ) {}

  sendTextMessage(phone: string, text: string, token?: string): Promise<void> {
    return this.provider.sendTextMessage(phone, text, token);
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
