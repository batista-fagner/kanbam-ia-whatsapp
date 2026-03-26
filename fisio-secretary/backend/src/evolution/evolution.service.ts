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

  constructor(
    private http: HttpService,
    private config: ConfigService,
  ) {
    this.baseUrl = config.get('EVOLUTION_BASE_URL') ?? '';
    this.apiKey = config.get('AUTHENTICATION_API_KEY') ?? '';
    this.instanceName = config.get('EVOLUTION_INSTANCE_NAME') ?? '';
  }

  async resolvePhone(remoteJid: string): Promise<string> {
    if (!remoteJid.includes('@lid')) return remoteJid;
    try {
      const res = await firstValueFrom(
        this.http.get(
          `${this.baseUrl}/chat/findContacts/${this.instanceName}`,
          { headers: { apikey: this.apiKey } },
        ),
      );
      const contacts: any[] = res.data ?? [];
      const match = contacts.find((c: any) => c.lid === remoteJid || c.id === remoteJid);
      if (match?.id) return match.id.replace('@s.whatsapp.net', '');
    } catch (err) {
      this.logger.error(`Erro ao resolver LID ${remoteJid}: ${err.message}`);
    }
    return remoteJid;
  }

  async sendTextMessage(phone: string, text: string): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post(
          `${this.baseUrl}/message/sendText/${this.instanceName}`,
          { number: phone, text },
          { headers: { apikey: this.apiKey } },
        ),
      );
    } catch (err) {
      this.logger.error(`Erro ao enviar mensagem para ${phone}: ${err.message}`);
    }
  }
}
