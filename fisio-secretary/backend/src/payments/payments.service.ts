import * as https from 'https';
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

  // ───────────────────────── Efí Bank — helpers ─────────────────────────

  private get _efiBaseUrl(): string {
    return this.config.get<string>('EFI_SANDBOX') === 'true'
      ? 'https://pix-h.api.efipay.com.br'
      : 'https://pix.api.efipay.com.br';
  }

  private _efiAgent(): https.Agent {
    const certB64 = this.config.get<string>('EFI_CERT_BASE64');
    const pass = this.config.get<string>('EFI_CERT_PASSPHRASE') ?? '';
    const sandbox = this.config.get<string>('EFI_SANDBOX') === 'true';
    if (certB64) {
      return new https.Agent({ pfx: Buffer.from(certB64, 'base64'), passphrase: pass, rejectUnauthorized: !sandbox });
    }
    // Sem certificado — só funciona em sandbox com rejectUnauthorized:false
    return new https.Agent({ rejectUnauthorized: false });
  }

  private async _efiToken(): Promise<string> {
    const cid = this.config.get<string>('EFI_CLIENT_ID');
    const cs = this.config.get<string>('EFI_CLIENT_SECRET');
    if (!cid || !cs) throw new BadRequestException('Efí Bank não configurado (EFI_CLIENT_ID/SECRET ausente)');

    const creds = Buffer.from(`${cid}:${cs}`).toString('base64');
    const r = await firstValueFrom(
      this.http.post(
        `${this._efiBaseUrl}/oauth/token`,
        'grant_type=client_credentials',
        {
          headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          httpsAgent: this._efiAgent(),
        },
      ),
    );
    return r.data.access_token as string;
  }

  // Gera cobrança PIX e retorna imagem QR (base64) + código copia-e-cola.
  // txid = UUID sem hífens (32 chars, dentro do limite 26-35 da Efí).
  private async _efiCreateCob(txid: string, descricao: string): Promise<{ qrCode: string; pixCode: string }> {
    const pixKey = this.config.get<string>('EFI_PIX_KEY');
    if (!pixKey) throw new BadRequestException('EFI_PIX_KEY não configurada');

    const token = await this._efiToken();
    const agent = this._efiAgent();
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    const cobR = await firstValueFrom(
      this.http.put(
        `${this._efiBaseUrl}/v2/cob/${txid}`,
        { calendario: { expiracao: 86400 }, valor: { original: '310.00' }, chave: pixKey, solicitacaoPagador: descricao },
        { headers, httpsAgent: agent },
      ),
    );

    const locId: number = cobR.data?.loc?.id;
    if (!locId) throw new Error('locId não retornado pela Efí Bank');

    const qrR = await firstValueFrom(
      this.http.get(`${this._efiBaseUrl}/v2/loc/${locId}/qrcode`, { headers, httpsAgent: agent }),
    );

    return {
      qrCode: qrR.data.imagemQrcode as string,  // PNG base64 (data:image/png;base64,...)
      pixCode: qrR.data.qrcode as string,         // texto copia-e-cola
    };
  }

  // ───────────────────────── Efí Bank PIX — Checkout inicial ─────────────────────────

  // Checkout PIX para novo cliente: pré-cria conta (isActive=false) → gera QR → ativa no webhook.
  async createPixCheckout(name: string, email: string, phone: string): Promise<{ qrCode: string; pixCode: string; expiresAt: string }> {
    if (await this.usersService.findByEmail(email)) {
      throw new BadRequestException('E-mail já cadastrado. Entre em contato ou use outro e-mail.');
    }

    const billingDay = new Date().getDate();
    const tenant = await this.configRepo.save(this.configRepo.create({
      displayName: name,
      profileName: name,
      agentType: 'megahair',
      isActive: false,     // ativado só após confirmação do pagamento
      connected: false,
      paymentMethod: 'pix',
      planStatus: 'pending',
      billingPhone: phone || null,
      billingDay,
    }));

    // Cria usuário já com senha temporária (hash). Senha real só vai no webhook após pagamento.
    const tempPassword = this._generatePassword();
    await this.usersService.create({ email, password: tempPassword, name, tenantId: tenant.id, role: 'operator' });

    const txid = tenant.id.replace(/-/g, ''); // 32 hex chars
    try {
      const pix = await this._efiCreateCob(txid, `Plano Convert Hair - ${name}`);
      this.logger.log(`[EFI] Checkout PIX criado txid=${txid} (${email})`);
      return { ...pix, expiresAt: new Date(Date.now() + 86400_000).toISOString() };
    } catch (err) {
      // Limpa registros criados para não deixar tenant fantasma
      const users = await this.usersService.findByTenant(tenant.id);
      for (const u of users) await this.usersService.resetPassword(u.id, '_disabled_');
      await this.configRepo.delete(tenant.id);
      throw new BadRequestException(`Erro ao gerar PIX: ${err.message}`);
    }
  }

  // ───────────────────────── Efí Bank PIX — Webhook ─────────────────────────

  async handleEfiWebhook(body: any): Promise<{ received: boolean }> {
    // A Efí envia: { "pix": [{ "txid": "...", "valor": "310.00", "endToEndId": "..." }] }
    // Também pode enviar { "evento": "teste_webhook" } no momento da configuração.
    if (body?.evento === 'teste_webhook') {
      this.logger.log('[EFI] Webhook de teste recebido ✅');
      return { received: true };
    }

    const pixList: Array<{ txid?: string }> = body?.pix ?? [];
    for (const pix of pixList) {
      if (!pix.txid || pix.txid.length !== 32) continue;

      // Reconstrói UUID a partir do txid (32 hex → 8-4-4-4-12)
      const raw = pix.txid;
      const tenantId = `${raw.slice(0,8)}-${raw.slice(8,12)}-${raw.slice(12,16)}-${raw.slice(16,20)}-${raw.slice(20)}`;

      const tenant = await this.configRepo.findOne({ where: { id: tenantId } });
      if (!tenant) {
        this.logger.warn(`[EFI] Tenant não encontrado para txid=${raw}`);
        continue;
      }

      if (tenant.planStatus === 'pending') {
        // Ativação inicial: gera nova senha, ativa conta, envia credenciais
        tenant.isActive = true;
        tenant.planStatus = 'active';
        await this.configRepo.save(tenant);

        const users = await this.usersService.findByTenant(tenantId);
        const user = users[0];
        if (user) {
          const password = this._generatePassword();
          await this.usersService.resetPassword(user.id, password);
          if (tenant.billingPhone) await this._sendCredentials(tenant.billingPhone, user.email, password);
        }
        this.logger.log(`[EFI] Pagamento inicial confirmado → tenant ${tenantId} ativado`);
      } else {
        // Renovação mensal
        tenant.planStatus = 'active';
        tenant.lastPixSentAt = new Date();
        await this.configRepo.save(tenant);
        this.logger.log(`[EFI] PIX mensal confirmado → tenant ${tenantId}`);
      }
    }

    return { received: true };
  }

  // ───────────────────────── PIX mensal (chamado pelo cron) ─────────────────────────

  async generateAndSendMonthlyPix(tenant: WhatsappConfig): Promise<void> {
    if (!tenant.billingPhone) return;

    let pixCode = '';
    let qrCode = '';

    try {
      const txid = tenant.id.replace(/-/g, '');
      const pix = await this._efiCreateCob(txid, `Renovação plano Convert Hair`);
      qrCode = pix.qrCode;
      pixCode = pix.pixCode;
      this.logger.log(`[EFI] QR mensal gerado para tenant ${tenant.id}`);
    } catch (err) {
      this.logger.error(`[EFI] Falha ao gerar QR mensal: ${err.message}`);
    }

    const msg =
      `Olá! 👋 Seu plano *Convert Hair* vence em breve.\n\n` +
      `💰 Valor: *R$ 310,00*\n\n` +
      (pixCode ? `📋 PIX copia e cola:\n${pixCode}` : `Entre em contato para renovar.`);

    await this._sendText(tenant.billingPhone, msg);

    // Envia imagem do QR code se disponível
    if (qrCode) {
      await this._sendText(tenant.billingPhone, qrCode); // TODO: enviar como imagem via sendMediaByUrl quando tiver upload de base64
    }

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
