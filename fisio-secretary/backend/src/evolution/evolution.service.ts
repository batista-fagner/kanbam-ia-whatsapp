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
