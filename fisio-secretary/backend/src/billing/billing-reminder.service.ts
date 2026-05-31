import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
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

  // Roda todo dia às 9h (Brasília). Envia lembrete para clientes cujo vencimento
  // é daqui a 5 dias (calculado a partir do billingDay fixo mensal).
  @Cron('0 9 * * *', { timeZone: TZ })
  async sendPaymentReminders() {
    const senderTenantId = this.config.get<string>('BILLING_SENDER_TENANT_ID');
    if (!senderTenantId) {
      this.logger.warn('[BILLING] BILLING_SENDER_TENANT_ID não configurado — job ignorado');
      return;
    }

    // BILLING_SENDER_TOKEN permite override direto (útil no dev sem DB prod)
    const envToken = this.config.get<string>('BILLING_SENDER_TOKEN');
    const senderConfig = envToken ? null : await this.configRepo.findOne({ where: { id: senderTenantId } });
    const senderToken = envToken || senderConfig?.instanceToken || this.config.get<string>('UAZAPI_TOKEN') || '';
    if (!senderToken) {
      this.logger.warn('[BILLING] Instância do admin não encontrada ou sem token');
      return;
    }

    const tenants = await this.configRepo.find({
      where: { billingPhone: Not(IsNull()), billingDay: Not(IsNull()), isActive: true },
    });

    const now = new Date(new Date().toLocaleString('en-US', { timeZone: TZ }));
    const todayDay = now.getDate();
    const todayMonth = now.getMonth();
    const todayYear = now.getFullYear();

    for (const tenant of tenants) {
      if (!tenant.billingPhone || !tenant.billingDay) continue;

      // Próxima data de vencimento: este mês se ainda não passou, senão próximo mês
      const lastDayThis = new Date(todayYear, todayMonth + 1, 0).getDate();
      const dayThis = Math.min(tenant.billingDay, lastDayThis);
      let billingDate = new Date(todayYear, todayMonth, dayThis);
      if (billingDate.getTime() <= now.getTime()) {
        const lastDayNext = new Date(todayYear, todayMonth + 2, 0).getDate();
        billingDate = new Date(todayYear, todayMonth + 1, Math.min(tenant.billingDay, lastDayNext));
      }

      // Lembrete = 5 dias antes do vencimento
      const reminderDate = new Date(billingDate.getTime() - 5 * 86400000);

      if (
        reminderDate.getDate() !== todayDay ||
        reminderDate.getMonth() !== todayMonth ||
        reminderDate.getFullYear() !== todayYear
      ) continue;

      const clientName = tenant.displayName || tenant.profileName || 'Cliente';
      const dueDateFormatted = billingDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

      const message =
        `Olá, ${clientName}! 👋\n\n` +
        `Seu plano vence em *5 dias* (${dueDateFormatted}).\n\n` +
        `Entre em contato para renovar e manter seu acesso ao sistema. 🙏`;

      const sent = await this.sendWhatsApp(tenant.billingPhone, message, senderToken);
      if (sent) this.logger.log(`[BILLING] Lembrete enviado → ${tenant.billingPhone} (${clientName}, vence dia ${tenant.billingDay})`);
    }
  }

  private async sendWhatsApp(phone: string, text: string, token: string): Promise<boolean> {
    const baseUrl = this.config.get<string>('UAZAPI_BASE_URL') ?? '';
    try {
      await firstValueFrom(
        this.http.post(
          `${baseUrl}/send/text`,
          { number: phone, text },
          { headers: { token } },
        ),
      );
      return true;
    } catch (err) {
      const status = err?.response?.status ?? 'N/A';
      this.logger.error(`[BILLING] Falha ao enviar para ${phone} [HTTP ${status}]: ${err.message}`);
      return false;
    }
  }
}
