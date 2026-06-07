import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import Stripe from 'stripe';
// Sob `module: nodenext` o Stripe resolve para os tipos CJS (export = StripeConstructor),
// que não expõem o namespace rico (Stripe.Checkout, etc). Os objetos de evento do webhook
// são tipados como `any` aqui — o runtime não é afetado.
import { WhatsappConfig } from '../common/entities/whatsapp-config.entity';
import { UsersService } from '../auth/users.service';

const CURRENCY = 'brl';

export interface CheckoutResult {
  url?: string; // cartão: redirecionar para Stripe
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly stripe: any;

  constructor(
    @InjectRepository(WhatsappConfig)
    private readonly configRepo: Repository<WhatsappConfig>,
    private readonly config: ConfigService,
    private readonly http: HttpService,
    private readonly usersService: UsersService,
  ) {
    const stripeKey = this.config.get<string>('STRIPE_SECRET_KEY');
    this.stripe = stripeKey ? new Stripe(stripeKey) : null;
  }

  // ───────────────────────── Checkout (público) ─────────────────────────

  async createCardCheckout(name: string, email: string, phone: string): Promise<CheckoutResult> {
    if (!this.stripe) throw new BadRequestException('Checkout por cartão não configurado (STRIPE_SECRET_KEY ausente)');
    const priceId = this.config.get<string>('STRIPE_PRICE_ID_MONTHLY');
    const frontendUrl = this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:5173';
    if (!priceId) throw new BadRequestException('STRIPE_PRICE_ID_MONTHLY não configurado');

    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: email,
      metadata: { name, phone, method: 'card' },
      subscription_data: { metadata: { name, phone, email } },
      success_url: `${frontendUrl}/checkout/success`,
      cancel_url: `${frontendUrl}/checkout`,
    });

    return { url: session.url ?? undefined };
  }

  // ───────────────────────── Webhook Stripe ─────────────────────────

  async handleWebhook(rawBody: Buffer, signature: string): Promise<{ received: boolean }> {
    if (!this.stripe) throw new BadRequestException('Stripe não configurado');
    const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET') ?? '';
    let event: any;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch (err) {
      this.logger.error(`[STRIPE] Assinatura inválida: ${err.message}`);
      throw new BadRequestException('Assinatura inválida');
    }

    this.logger.log(`[STRIPE] Evento recebido: ${event.type}`);
    switch (event.type) {
      case 'checkout.session.completed':
        await this._onCardCheckoutCompleted(event.data.object);
        break;
      case 'invoice.payment_failed':
        await this._onInvoiceFailed(event.data.object);
        break;
      case 'customer.subscription.deleted':
        await this._onSubscriptionDeleted(event.data.object);
        break;
      default:
        break;
    }
    return { received: true };
  }

  private async _onCardCheckoutCompleted(session: any): Promise<void> {
    const meta = session.metadata ?? {};
    const email = session.customer_email ?? session.customer_details?.email ?? '';
    const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
    const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;

    if (subscriptionId) {
      const existing = await this.configRepo.findOne({ where: { stripeSubscriptionId: subscriptionId } });
      if (existing) {
        this.logger.log(`[STRIPE] Subscription ${subscriptionId} já processada — ignorando`);
        return;
      }
    }

    await this._createClientFromPayment(meta.name ?? 'Cliente', email, meta.phone ?? '', 'card', {
      stripeCustomerId: customerId ?? null,
      stripeSubscriptionId: subscriptionId ?? null,
    });
  }

  private async _onInvoiceFailed(invoice: any): Promise<void> {
    const subscriptionId = typeof invoice.subscription === 'string'
      ? invoice.subscription
      : invoice.subscription?.id;
    if (!subscriptionId) return;
    const tenant = await this.configRepo.findOne({ where: { stripeSubscriptionId: subscriptionId } });
    if (tenant) {
      tenant.planStatus = 'past_due';
      await this.configRepo.save(tenant);
      this.logger.warn(`[STRIPE] Pagamento de cartão falhou → tenant ${tenant.id} marcado past_due`);
    }
  }

  private async _onSubscriptionDeleted(sub: any): Promise<void> {
    const tenant = await this.configRepo.findOne({ where: { stripeSubscriptionId: sub.id } });
    if (tenant) {
      tenant.planStatus = 'canceled';
      await this.configRepo.save(tenant);
      this.logger.warn(`[STRIPE] Subscription cancelada → tenant ${tenant.id} marcado canceled`);
    }
  }

  // ───────────────────────── Efí Bank PIX ─────────────────────────

  async createEfiPixQrCode(tenantId: string, phone: string): Promise<{ qrCode: string; pixCode: string }> {
    const clientId = this.config.get<string>('EFI_CLIENT_ID');
    const clientSecret = this.config.get<string>('EFI_CLIENT_SECRET');

    if (!clientId || !clientSecret) {
      throw new BadRequestException('Efí Bank não configurado (EFI_CLIENT_ID ou EFI_CLIENT_SECRET ausente)');
    }

    try {
      // ⚠️ TODO: adaptar conforme documentação real da API Efí Bank
      // Endpoints esperados:
      // - POST /account/{account_id}/finances/pix/qrcodes/ → gerar QR dinâmico
      // - Resposta esperada: { qrCode: "string", pixCode: "string", expiresAt: "timestamp" }

      const payload = {
        amount: 31000, // R$ 310,00 em centavos
        type: 'DYNAMIC',
        label: 'Plano Convert Hair',
      };

      const response = await firstValueFrom(
        this.http.post('https://api.pagar.me/core/v5/pix', payload, {
          headers: {
            'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
            'Content-Type': 'application/json',
          },
        }),
      );

      this.logger.log(`[EFI] QR code gerado para tenant ${tenantId}`);
      return {
        qrCode: response.data?.qr_code_image,
        pixCode: response.data?.qr_code,
      };
    } catch (err) {
      this.logger.error(`[EFI] Erro ao gerar QR code: ${err.message}`);
      throw new BadRequestException(`Efí: ${err.message}`);
    }
  }

  async handleEfiWebhook(body: any): Promise<{ received: boolean }> {
    this.logger.log(`[EFI] Webhook recebido: ${JSON.stringify(body)}`);

    // ⚠️ TODO: adaptar conforme documentação real da API Efí Bank
    // Webhook esperado:
    // {
    //   event: "charge.paid" | "charge.failed",
    //   data: {
    //     charge_id: "string",
    //     amount: 31000,
    //     status: "paid" | "failed",
    //     metadata: { tenantId: "uuid", phone: "string" }
    //   }
    // }

    const tenantId = body?.data?.metadata?.tenantId;
    const phone = body?.data?.metadata?.phone;
    const status = body?.data?.status;

    if (!tenantId || !status) {
      return { received: true };
    }

    if (status === 'paid') {
      // Novo cliente (cadastro inicial via PIX)
      const existingUser = await this.usersService.findByEmail(body?.data?.metadata?.email);
      if (!existingUser) {
        await this._createClientFromPayment(
          body?.data?.metadata?.name ?? 'Cliente',
          body?.data?.metadata?.email ?? '',
          phone,
          'pix',
          {},
        );
      } else {
        // Renovação mensal (cliente existente)
        const tenant = await this.configRepo.findOne({ where: { id: tenantId } });
        if (tenant) {
          tenant.planStatus = 'active';
          tenant.lastPixSentAt = new Date();
          await this.configRepo.save(tenant);
          this.logger.log(`[EFI] PIX mensal pago → tenant ${tenant.id} reativado`);
        }
      }
    }

    return { received: true };
  }

  // ───────────────────────── PIX mensal (chamado pelo cron) ─────────────────────────

  async generateAndSendMonthlyPix(tenant: WhatsappConfig): Promise<void> {
    if (!tenant.billingPhone) return;

    let pixCode = '';
    let pixQrUrl = '';

    // Tenta gerar QR code via Efí Bank
    try {
      const pix = await this.createEfiPixQrCode(tenant.id, tenant.billingPhone);
      pixQrUrl = pix.qrCode;
      pixCode = pix.pixCode;
    } catch (err) {
      this.logger.error(`[EFI] Falha ao gerar QR: ${err.message}`);
      // Continua mesmo sem QR (envia lembrete simples)
    }

    // Monta mensagem
    const msg =
      `Olá! 👋 Seu plano *Convert Hair* está chegando no vencimento.\n\n` +
      `💰 Valor: *R$ 310,00*\n\n` +
      (pixCode ? `Pix para pagar:\n*${pixCode}*` : `Entre em contato para renovar o seu plano.`);

    // Envia texto
    await this._sendText(tenant.billingPhone, msg);

    // ⚠️ TODO: enviar QR code via `/send/pix-button` (uazapi) quando Efí estiver pronto
    // await this._sendPixButton(tenant.billingPhone, pixQrUrl, pixCode);

    tenant.lastPixSentAt = new Date();
    await this.configRepo.save(tenant);
    this.logger.log(`[EFI] PIX mensal enviado → ${tenant.billingPhone} (tenant ${tenant.id})`);
  }

  // ───────────────────────── Helpers ─────────────────────────

  private async _createClientFromPayment(
    name: string,
    email: string,
    phone: string,
    paymentMethod: 'card' | 'pix',
    extra: { stripeCustomerId?: string | null; stripeSubscriptionId?: string | null },
  ): Promise<void> {
    if (!email) {
      this.logger.error('[PAYMENTS] Pagamento sem email — não foi possível criar conta');
      return;
    }
    const existingUser = await this.usersService.findByEmail(email);
    if (existingUser) {
      this.logger.log(`[PAYMENTS] Usuário ${email} já existe — ignorando criação`);
      return;
    }

    const billingDay = new Date().getDate();

    const tenant = this.configRepo.create({
      displayName: name,
      profileName: name,
      agentType: 'megahair',
      isActive: true,
      connected: false,
      paymentMethod,
      planStatus: 'active',
      billingPhone: phone || null,
      billingDay,
      stripeCustomerId: extra.stripeCustomerId ?? null,
      stripeSubscriptionId: extra.stripeSubscriptionId ?? null,
    });
    const saved = await this.configRepo.save(tenant);

    const password = this._generatePassword();
    await this.usersService.create({
      email,
      password,
      name,
      tenantId: saved.id,
      role: 'operator',
    });

    this.logger.log(`[PAYMENTS] Conta criada → tenant ${saved.id} (${email}, ${paymentMethod})`);

    if (phone) await this._sendCredentials(phone, email, password);
  }

  private async _sendCredentials(phone: string, email: string, password: string): Promise<void> {
    const frontendUrl = this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:5173';
    const msg =
      `🎉 Sua conta *Convert Hair* foi criada com sucesso!\n\n` +
      `Acesse: ${frontendUrl}/login\n\n` +
      `📧 E-mail: ${email}\n` +
      `🔑 Senha: ${password}\n\n` +
      `Recomendamos trocar a senha após o primeiro acesso. 🙏`;
    await this._sendText(phone, msg);
  }

  private _generatePassword(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    let out = '';
    for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }

  private async _resolveSenderToken(): Promise<string> {
    const envToken = this.config.get<string>('BILLING_SENDER_TOKEN');
    if (envToken) return envToken;
    const senderTenantId = this.config.get<string>('BILLING_SENDER_TENANT_ID');
    if (senderTenantId) {
      const sc = await this.configRepo.findOne({ where: { id: senderTenantId } });
      if (sc?.instanceToken) return sc.instanceToken;
    }
    return this.config.get<string>('UAZAPI_TOKEN') ?? '';
  }

  private async _sendText(phone: string, text: string): Promise<void> {
    const baseUrl = this.config.get<string>('UAZAPI_BASE_URL') ?? '';
    const token = await this._resolveSenderToken();
    try {
      await firstValueFrom(this.http.post(`${baseUrl}/send/text`, { number: phone, text }, { headers: { token } }));
    } catch (err) {
      this.logger.error(`[PAYMENTS] Falha ao enviar texto para ${phone} [HTTP ${err?.response?.status ?? 'N/A'}]: ${err.message}`);
    }
  }

  async listOverdue(): Promise<WhatsappConfig[]> {
    return this.configRepo.find({ where: { planStatus: 'past_due' } });
  }
}
