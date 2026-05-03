import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { IWhatsAppProvider } from './whatsapp-provider.interface';

@Injectable()
export class UazapiProvider implements IWhatsAppProvider {
  private readonly logger = new Logger(UazapiProvider.name);
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    this.baseUrl = config.get('UAZAPI_BASE_URL') ?? '';
    this.token = config.get('UAZAPI_TOKEN') ?? '';
  }

  async sendTextMessage(phone: string, text: string): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post(
          `${this.baseUrl}/send/text`,
          { number: phone, text },
          { headers: { token: this.token } },
        ),
      );
    } catch (err) {
      this.logger.error(`Erro ao enviar mensagem para ${phone}: ${err.message}`);
    }
  }

  async sendAudioMessage(phone: string, audioBuffer: Buffer): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post(
          `${this.baseUrl}/send/media`,
          { number: phone, type: 'ptt', file: audioBuffer.toString('base64'), delay: 2000 },
          { headers: { token: this.token } },
        ),
      );
    } catch (err) {
      this.logger.error(`Erro ao enviar áudio para ${phone}: ${err.message}`);
    }
  }

  async sendTypingIndicator(phone: string, durationMs = 3000): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post(
          `${this.baseUrl}/message/presence`,
          { number: phone, presence: 'composing', delay: durationMs },
          { headers: { token: this.token } },
        ),
      );
    } catch (err) {
      this.logger.warn(`Erro ao enviar typing indicator para ${phone}: ${err.message}`);
    }
  }

  async transcribeAudio(messageId: string): Promise<string> {
    const response = await firstValueFrom(
      this.http.post(
        `${this.baseUrl}/message/download`,
        { id: messageId, transcribe: true, generate_mp3: false, return_link: false, openai_apikey: this.config.get('OPENAI_API_KEY') },
        { headers: { token: this.token } },
      ),
    );
    return (response.data as any).transcription ?? '';
  }
}
