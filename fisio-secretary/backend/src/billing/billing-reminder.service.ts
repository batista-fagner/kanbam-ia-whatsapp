import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, Not } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { WhatsappConfig } from '../common/entities/whatsapp-config.entity';
import { PaymentsService } from '../payments/payments.service';

const TZ = 'America/Sao_Paulo';
const MS_DAY = 86400000;

@Injectable()
export class BillingReminderService {
  private readonly logger = new Logger(BillingReminderService.name);

  constructor(
    @InjectRepository(WhatsappConfig)
    private readonly configRepo: Repository<WhatsappConfig>,
    private readonly config: ConfigService,
    private readonly http: HttpService,
    private readonly payments: PaymentsService,
  ) {}

  // Roda todo dia às 9h (Brasília). Trata cobrança conforme o método do cliente:
  //  - 'pix'    → gera/reenvia QR PIX (Efí) + e-mail, na janela de 2 dias antes até o vencimento
  //  - 'manual' → lembrete de texto exatamente 2 dias antes (legado, sem PIX real)
  //  - 'card'   → nada (cobrança recorrente automática no cartão)
  @Cron('0 9 * * *', { timeZone: TZ })
  async sendPaymentReminders() {
    const senderToken = await this.resolveSenderToken();
    if (!senderToken) {
      this.logger.warn('[BILLING] Sem token de remetente — job ignorado');
      return;
    }

    const tenants = await this.configRepo.find({
      where: { billingPhone: Not(IsNull()), billingDay: Not(IsNull()), isActive: true },
    });

    const now = new Date(new Date().toLocaleString('en-US', { timeZone: TZ }));

    for (const tenant of tenants) {
      try {
        if (!tenant.billingPhone || !tenant.billingDay) continue;

        const dueDate = this.computeDue(tenant.billingDay, now, /* strictlyAfter */ false);
        const daysBefore = this.daysBetween(now, dueDate);

        if (tenant.paymentMethod === 'pix') {
          await this.handlePixCycle(tenant, now, daysBefore);
        } else if (tenant.paymentMethod === 'card') {
          // cobrança automática — nada a fazer aqui
        } else {
          // 'manual' (legado): lembrete em texto 2 dias antes
          if (daysBefore === 2) {
            const msg = this.buildManualReminder(tenant, dueDate);
            const sent = await this.sendWhatsApp(tenant.billingPhone, msg, senderToken);
            if (sent) this.logger.log(`[BILLING] Lembrete (manual) enviado → ${tenant.billingPhone} (${tenant.displayName ?? 'Cliente'})`);
          }
        }
      } catch (err) {
        this.logger.error(`[BILLING] Erro ao processar tenant ${tenant.id}: ${err.message}`);
      }
    }
  }

  // Janela PIX: 0..2 dias antes do vencimento. Reenvia diariamente até pagar (webhook → 'active').
  private async handlePixCycle(tenant: WhatsappConfig, now: Date, daysBefore: number) {
    if (daysBefore < 0 || daysBefore > 2) return;

    const recentlyBilled = tenant.lastPixSentAt && this.daysBetween(new Date(tenant.lastPixSentAt), now) <= 6;
    const alreadyPaidThisCycle = tenant.planStatus === 'active' && recentlyBilled;

    if (!alreadyPaidThisCycle) {
      if (!this.isSameDay(tenant.lastPixSentAt, now)) {
        await this.payments.generateAndSendMonthlyPix(tenant); // grava lastPixSentAt
      }
      if (tenant.planStatus === 'active') {
        tenant.planStatus = 'pending';
        await this.configRepo.save(tenant);
      }
    }

    // Dia do vencimento sem pagamento confirmado → alerta no painel (sem bloquear)
    if (daysBefore === 0 && tenant.planStatus !== 'active') {
      tenant.planStatus = 'past_due';
      await this.configRepo.save(tenant);
      this.logger.warn(`[BILLING] PIX não pago no vencimento → tenant ${tenant.id} marcado past_due`);
    }
  }

  private buildManualReminder(tenant: WhatsappConfig, dueDate: Date): string {
    const clientName = tenant.displayName || tenant.profileName || 'Cliente';
    const due = dueDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    return (
      `Olá, ${clientName}! 👋\n\n` +
      `Seu plano vence em *2 dias* (${due}).\n\n` +
      `Entre em contato para renovar e manter seu acesso ao sistema. 🙏`
    );
  }

  // ───────────────────────── helpers de data ─────────────────────────

  // Próximo vencimento. strictlyAfter=false → o próprio dia de hoje conta como vencimento (daysBefore=0).
  private computeDue(billingDay: number, now: Date, strictlyAfter: boolean): Date {
    const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
    const lastThis = new Date(y, m + 1, 0).getDate();
    const dayThis = Math.min(billingDay, lastThis);
    const cond = strictlyAfter ? dayThis > d : dayThis >= d;
    if (cond) return new Date(y, m, dayThis);
    const lastNext = new Date(y, m + 2, 0).getDate();
    return new Date(y, m + 1, Math.min(billingDay, lastNext));
  }

  private daysBetween(from: Date, to: Date): number {
    const a = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
    const b = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
    return Math.round((b - a) / MS_DAY);
  }

  private isSameDay(a: Date | null | undefined, b: Date): boolean {
    if (!a) return false;
    const d = new Date(a);
    return d.getFullYear() === b.getFullYear() && d.getMonth() === b.getMonth() && d.getDate() === b.getDate();
  }

  // ───────────────────────── envio WhatsApp ─────────────────────────

  private async resolveSenderToken(): Promise<string> {
    const envToken = this.config.get<string>('BILLING_SENDER_TOKEN');
    if (envToken) return envToken;
    const senderTenantId = this.config.get<string>('BILLING_SENDER_TENANT_ID');
    if (senderTenantId) {
      const sc = await this.configRepo.findOne({ where: { id: senderTenantId } });
      if (sc?.instanceToken) return sc.instanceToken;
    }
    return this.config.get<string>('UAZAPI_TOKEN') ?? '';
  }

  private async sendWhatsApp(phone: string, text: string, token: string): Promise<boolean> {
    const baseUrl = this.config.get<string>('UAZAPI_BASE_URL') ?? '';
    try {
      await firstValueFrom(
        this.http.post(`${baseUrl}/send/text`, { number: phone, text }, { headers: { token } }),
      );
      return true;
    } catch (err) {
      const status = err?.response?.status ?? 'N/A';
      this.logger.error(`[BILLING] Falha ao enviar para ${phone} [HTTP ${status}]: ${err.message}`);
      return false;
    }
  }
}
