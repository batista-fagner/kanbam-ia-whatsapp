import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, Not } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { WhatsappConfig } from '../common/entities/whatsapp-config.entity';

const TZ = 'America/Sao_Paulo';

@Injectable()
export class BillingReminderService {
  private readonly logger = new Logger(BillingReminderService.name);

  constructor(
    @InjectRepository(WhatsappConfig)
    private readonly configRepo: Repository<WhatsappConfig>,
    private readonly config: ConfigService,
    private readonly http: HttpService,
  ) {}

  // Roda todo dia às 9h (horário de Brasília). Envia lembrete 5 dias antes do vencimento.
  @Cron('0 9 * * *', { timeZone: TZ })
  async sendPaymentReminders() {
    const senderTenantId = this.config.get<string>('BILLING_SENDER_TENANT_ID');
    if (!senderTenantId) {
      this.logger.warn('[BILLING] BILLING_SENDER_TENANT_ID não configurado — job ignorado');
      return;
    }

    const senderConfig = await this.configRepo.findOne({ where: { id: senderTenantId } });
    if (!senderConfig?.instanceToken) {
      this.logger.warn('[BILLING] Instância do admin não encontrada ou sem token');
      return;
    }

    const tenants = await this.configRepo.find({
      where: { billingPhone: Not(IsNull()), nextPaymentDate: Not(IsNull()), isActive: true },
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const tenant of tenants) {
      if (!tenant.nextPaymentDate || !tenant.billingPhone) continue;

      const due = new Date(tenant.nextPaymentDate);
      due.setHours(0, 0, 0, 0);

      const daysLeft = Math.round((due.getTime() - today.getTime()) / 86400000);
      if (daysLeft !== 5) continue;

      const dueDateFormatted = due.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const clientName = tenant.displayName || tenant.profileName || 'Cliente';

      const message =
        `Olá, ${clientName}! 👋\n\n` +
        `Seu plano vence em *5 dias* (${dueDateFormatted}).\n\n` +
        `Entre em contato para renovar e manter seu acesso ao sistema. 🙏`;

      await this.sendWhatsApp(tenant.billingPhone, message, senderConfig.instanceToken);
      this.logger.log(`[BILLING] Lembrete enviado → ${tenant.billingPhone} (${clientName}, vence ${dueDateFormatted})`);
    }
  }

  private async sendWhatsApp(phone: string, text: string, token: string) {
    const baseUrl = this.config.get<string>('UAZAPI_BASE_URL') ?? '';
    try {
      await firstValueFrom(
        this.http.post(
          `${baseUrl}/send/text`,
          { number: phone, text, delay: 1000 },
          { headers: { token } },
        ),
      );
    } catch (err) {
      const status = err?.response?.status ?? 'N/A';
      this.logger.error(`[BILLING] Falha ao enviar para ${phone} [HTTP ${status}]: ${err.message}`);
    }
  }
}
