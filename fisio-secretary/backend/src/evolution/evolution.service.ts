import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class EvolutionService {
  private readonly logger = new Logger(EvolutionService.name);
  private readonly baseUrl: string = '';
  private readonly apiKey: string = '';
  private readonly instanceName: string = '';
  private readonly uazapiBaseUrl: string = '';
  private readonly uazapiToken: string = '';

  constructor(
    private http: HttpService,
    private config: ConfigService,
  ) {
    this.baseUrl = config.get('EVOLUTION_BASE_URL') ?? '';
    this.apiKey = config.get('AUTHENTICATION_API_KEY') ?? '';
    this.instanceName = config.get('EVOLUTION_INSTANCE_NAME') ?? '';
    this.uazapiBaseUrl = config.get('UAZAPI_BASE_URL') ?? '';
    this.uazapiToken = config.get('UAZAPI_TOKEN') ?? '';
  }

  async sendTypingIndicator(phone: string, durationMs = 3000): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post(
          `${this.uazapiBaseUrl}/message/presence`,
          { number: phone, presence: 'composing', delay: durationMs },
          { headers: { token: this.uazapiToken } },
        ),
      );
    } catch (err) {
      this.logger.warn(`Erro ao enviar typing indicator para ${phone}: ${err.message}`);
    }
  }

  async sendTextMessage(phone: string, text: string): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post(
          `${this.uazapiBaseUrl}/send/text`,
          { number: phone, text },
          { headers: { token: this.uazapiToken } },
        ),
      );
    } catch (err) {
      this.logger.error(`Erro ao enviar mensagem para ${phone}: ${err.message}`);
    }
  }

  async transcribeAudio(messageId: string): Promise<string> {
    const response = await firstValueFrom(
      this.http.post(
        `${this.uazapiBaseUrl}/message/download`,
        {
          id: messageId,
          transcribe: true,
          generate_mp3: false,
          return_link: false,
          openai_apikey: this.config.get('OPENAI_API_KEY'),
        },
        { headers: { token: this.uazapiToken } },
      ),
    );
    return (response.data as any).transcription ?? '';
  }

  async sendAudioMessage(phone: string, audioBuffer: Buffer): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post(
          `${this.uazapiBaseUrl}/send/media`,
          {
            number: phone,
            type: 'ptt',
            file: audioBuffer.toString('base64'),
            delay: 2000,
          },
          { headers: { token: this.uazapiToken } },
        ),
      );
    } catch (err) {
      this.logger.error(`Erro ao enviar áudio para ${phone}: ${err.message}`);
    }
  }
}
