import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { firstValueFrom } from 'rxjs';
import { IWhatsAppProvider } from './whatsapp-provider.interface';
import { WhatsappConfig } from '../../common/entities/whatsapp-config.entity';

@Injectable()
export class UazapiProvider implements IWhatsAppProvider {
  private readonly logger = new Logger(UazapiProvider.name);
  private readonly baseUrl: string;
  private readonly envToken: string;
  private readonly adminToken: string;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    @InjectRepository(WhatsappConfig)
    private readonly configRepo: Repository<WhatsappConfig>,
  ) {
    this.baseUrl = config.get('UAZAPI_BASE_URL') ?? '';
    this.envToken = config.get('UAZAPI_TOKEN') ?? '';
    this.adminToken = config.get('UAZAPI_ADMIN_TOKEN') ?? '';
  }

  private async resolveToken(token?: string): Promise<string> {
    if (token) return token;

    const record = await this.configRepo.findOne({
      where: {},
      order: { createdAt: 'DESC' },
    });

    return record?.instanceToken || this.envToken;
  }

  private maskToken(t: string): string {
    if (!t) return '(vazio)';
    if (t.length <= 8) return `${t.slice(0, 2)}***`;
    return `${t.slice(0, 4)}...${t.slice(-4)}`;
  }

  private logHttpError(context: string, err: any, extra: Record<string, any> = {}): void {
    const status = err?.response?.status ?? err?.status ?? 'N/A';
    const data = err?.response?.data ? JSON.stringify(err.response.data) : 'sem body';
    const url = err?.config?.url ?? extra.url ?? 'N/A';
    const extraStr = Object.entries(extra)
      .filter(([k]) => k !== 'url')
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');
    this.logger.error(
      `${context} [HTTP ${status}] url=${url} ${extraStr} | erro: ${err.message} | uazapi response: ${data}`,
    );
    if (status === 401 || status === 403) {
      this.logger.error(
        `⚠️ [AUTH ERROR] Token uazapi inválido ou expirado. Verifique UAZAPI_TOKEN e o token salvo em whatsapp_config.instanceToken. Reconecte a instância se necessário.`,
      );
    }
  }

  async sendTextMessage(phone: string, text: string, token?: string): Promise<void> {
    const useToken = await this.resolveToken(token);
    try {
      await firstValueFrom(
        this.http.post(
          `${this.baseUrl}/send/text`,
          { number: phone, text },
          { headers: { token: useToken } },
        ),
      );
    } catch (err) {
      this.logHttpError(`Erro ao enviar mensagem para ${phone}`, err, {
        url: `${this.baseUrl}/send/text`,
        token: this.maskToken(useToken),
        textLen: text.length,
      });
    }
  }

  async sendAudioMessage(phone: string, audioBuffer: Buffer, token?: string): Promise<void> {
    const useToken = await this.resolveToken(token);
    try {
      await firstValueFrom(
        this.http.post(
          `${this.baseUrl}/send/media`,
          { number: phone, type: 'ptt', file: audioBuffer.toString('base64'), delay: 2000 },
          { headers: { token: useToken } },
        ),
      );
    } catch (err) {
      this.logHttpError(`Erro ao enviar áudio para ${phone}`, err, {
        url: `${this.baseUrl}/send/media`,
        token: this.maskToken(useToken),
        bufferBytes: audioBuffer.length,
      });
    }
  }

  async sendTypingIndicator(phone: string, durationMs = 3000, token?: string): Promise<void> {
    const useToken = await this.resolveToken(token);
    try {
      await firstValueFrom(
        this.http.post(
          `${this.baseUrl}/message/presence`,
          { number: phone, presence: 'composing', delay: durationMs },
          { headers: { token: useToken } },
        ),
      );
    } catch (err) {
      const status = err?.response?.status ?? 'N/A';
      this.logger.warn(`Erro ao enviar typing indicator para ${phone} [HTTP ${status}]: ${err.message}`);
    }
  }

  async transcribeAudio(messageId: string, token?: string): Promise<string> {
    const useToken = await this.resolveToken(token);
    const response = await firstValueFrom(
      this.http.post(
        `${this.baseUrl}/message/download`,
        { id: messageId, transcribe: true, generate_mp3: false, return_link: false, openai_apikey: this.config.get('OPENAI_API_KEY') },
        { headers: { token: useToken } },
      ),
    );
    return (response.data as any).transcription ?? '';
  }

  async connectInstance(phone?: string, token?: string): Promise<any> {
    const useToken = await this.resolveToken(token);
    const body: any = { browser: 'auto' };
    if (phone) body.phone = phone;

    const response = await firstValueFrom(
      this.http.post(
        `${this.baseUrl}/instance/connect`,
        body,
        { headers: { token: useToken } },
      ),
    );
    return response.data;
  }

  async getInstanceStatus(token?: string): Promise<any> {
    const useToken = await this.resolveToken(token);
    const response = await firstValueFrom(
      this.http.get(
        `${this.baseUrl}/instance/status`,
        { headers: { token: useToken } },
      ),
    );
    return response.data;
  }

  async disconnectInstance(token?: string): Promise<any> {
    const useToken = await this.resolveToken(token);
    const response = await firstValueFrom(
      this.http.post(
        `${this.baseUrl}/instance/disconnect`,
        {},
        { headers: { token: useToken } },
      ),
    );
    return response.data;
  }

  async resetInstance(token?: string): Promise<any> {
    const useToken = await this.resolveToken(token);
    const response = await firstValueFrom(
      this.http.post(
        `${this.baseUrl}/instance/reset`,
        {},
        { headers: { token: useToken } },
      ),
    );
    return response.data;
  }

  async deleteInstance(token?: string): Promise<any> {
    const useToken = await this.resolveToken(token);
    const response = await firstValueFrom(
      this.http.delete(
        `${this.baseUrl}/instance`,
        { headers: { token: useToken } },
      ),
    );
    return response.data;
  }

  async configureWebhook(webhookUrl: string, token?: string): Promise<any> {
    const useToken = await this.resolveToken(token);
    const response = await firstValueFrom(
      this.http.post(
        `${this.baseUrl}/webhook`,
        {
          enabled: true,
          url: webhookUrl,
          events: ['messages', 'connection'],
          excludeMessages: ['wasSentByApi', 'isGroupYes'],
        },
        { headers: { token: useToken } },
      ),
    );
    return response.data;
  }

  async getWebhookConfig(token?: string): Promise<any> {
    const useToken = await this.resolveToken(token);
    const response = await firstValueFrom(
      this.http.get(
        `${this.baseUrl}/webhook`,
        { headers: { token: useToken } },
      ),
    );
    return response.data;
  }

  async sendMediaByUrl(phone: string, url: string, type: 'image' | 'video', caption?: string, token?: string): Promise<void> {
    const useToken = await this.resolveToken(token);
    try {
      await firstValueFrom(
        this.http.post(
          `${this.baseUrl}/send/media`,
          { number: phone, file: url, type, text: caption ?? '', delay: 1000 },
          { headers: { token: useToken } },
        ),
      );
    } catch (err) {
      this.logHttpError(`Erro ao enviar mídia para ${phone}`, err, {
        url: `${this.baseUrl}/send/media`,
        token: this.maskToken(useToken),
        type,
        mediaUrl: url,
      });
    }
  }

  async createInstance(name: string, adminField01?: string, adminField02?: string): Promise<any> {
    const body: any = { name };
    if (adminField01) body.adminField01 = adminField01;
    if (adminField02) body.adminField02 = adminField02;

    const response = await firstValueFrom(
      this.http.post(
        `${this.baseUrl}/instance/create`,
        body,
        { headers: { admintoken: this.adminToken } },
      ),
    );
    return response.data;
  }

  async configureGlobalWebhook(url: string, events: string[] = ['messages', 'connection'], excludeMessages: string[] = ['wasSentByApi']): Promise<any> {
    const response = await firstValueFrom(
      this.http.post(
        `${this.baseUrl}/globalwebhook`,
        { url, events, excludeMessages },
        { headers: { admintoken: this.adminToken } },
      ),
    );
    return response.data;
  }
}
