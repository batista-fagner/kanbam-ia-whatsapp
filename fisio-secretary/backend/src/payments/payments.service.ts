import * as https from 'https';
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import Stripe from 'stripe';
import FormData = require('form-data');
// Sob `module: nodenext` o Stripe resolve para os tipos CJS (export = StripeConstructor),
// que não expõem o namespace rico (Stripe.Checkout, etc). Os objetos de evento do webhook
// são tipados como `any` aqui — o runtime não é afetado.
import { WhatsappConfig } from '../common/entities/whatsapp-config.entity';
import { ImplantacaoPayment } from '../common/entities/implantacao-payment.entity';
import { UsersService } from '../auth/users.service';

const CURRENCY = 'brl';

export interface CheckoutResult {
  url?: string; // cartão: redirecionar para Stripe
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly stripe: any;
  private _efiTokenCache: { token: string; expiresAt: number } | null = null;

  constructor(
    @InjectRepository(WhatsappConfig)
    private readonly configRepo: Repository<WhatsappConfig>,
    @InjectRepository(ImplantacaoPayment)
    private readonly implantacaoRepo: Repository<ImplantacaoPayment>,
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
      case 'customer.subscription.created':
        await this._onSubscriptionCreated(event.data.object);
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

  // Cria a conta quando a subscription é criada (dispara junto com ou antes do checkout.session.completed).
  // Idempotente: se a subscription já está no banco (criada pelo checkout.session.completed), ignora.
  private async _onSubscriptionCreated(sub: any): Promise<void> {
    const subscriptionId = sub.id as string;
    if (!subscriptionId) return;

    const existing = await this.configRepo.findOne({ where: { stripeSubscriptionId: subscriptionId } });
    if (existing) {
      this.logger.log(`[STRIPE] Subscription ${subscriptionId} já processada — ignorando`);
      return;
    }

    const meta = sub.metadata ?? {};
    const email = meta.email ?? '';
    const name = meta.name ?? 'Cliente';
    const phone = meta.phone ?? '';
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;

    if (!email) {
      this.logger.warn(`[STRIPE] customer.subscription.created sem email no metadata — sub ${subscriptionId}`);
      return;
    }

    await this._createClientFromPayment(name, email, phone, 'card', {
      stripeCustomerId: customerId ?? null,
      stripeSubscriptionId: subscriptionId,
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
    return new https.Agent({ rejectUnauthorized: false });
  }

  private async _efiToken(): Promise<string> {
    if (this._efiTokenCache && this._efiTokenCache.expiresAt > Date.now() + 60_000) {
      return this._efiTokenCache.token;
    }
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
    const token = r.data.access_token as string;
    const expiresIn = (r.data.expires_in ?? 3600) as number;
    this._efiTokenCache = { token, expiresAt: Date.now() + expiresIn * 1000 };
    return token;
  }

  // Gera cobrança PIX e retorna imagem QR (base64) + código copia-e-cola.
  // txid = UUID sem hífens (32 chars, dentro do limite 26-35 da Efí).
  private async _efiCreateCob(txid: string, descricao: string, amount = '490.00'): Promise<{ qrCode: string; pixCode: string }> {
    const pixKey = this.config.get<string>('EFI_PIX_KEY');
    if (!pixKey) throw new BadRequestException('EFI_PIX_KEY não configurada');

    const token = await this._efiToken();
    const agent = this._efiAgent();
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    const cobR = await firstValueFrom(
      this.http.put(
        `${this._efiBaseUrl}/v2/cob/${txid}`,
        { calendario: { expiracao: 86400 }, valor: { original: amount }, chave: pixKey, solicitacaoPagador: descricao },
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

  // Consulta o status de uma cobrança. Retorna 'ATIVA' | 'CONCLUIDA' | 'REMOVIDA_*' | null (não existe).
  private async _efiGetCobStatus(txid: string): Promise<string | null> {
    const token = await this._efiToken();
    try {
      const r = await firstValueFrom(
        this.http.get(`${this._efiBaseUrl}/v2/cob/${txid}`, {
          headers: { Authorization: `Bearer ${token}` },
          httpsAgent: this._efiAgent(),
        }),
      );
      return (r.data?.status as string) ?? null;
    } catch (err) {
      if (err?.response?.status === 404) return null;
      if (err?.response?.status === 400) return 'EXPIRADA'; // cobrança vencida
      throw err;
    }
  }

  // ───────────────────────── Efí Bank PIX — Checkout (assíncrono) ─────────────────────────

  // Pré-cria a conta (isActive=false, pending) e dispara o envio do QR pelo WhatsApp em background.
  // Responde IMEDIATAMENTE — não espera a Efí Bank. O QR chega no WhatsApp em até ~2 min.
  // A confirmação do pagamento é feita por polling (pollPendingPix), não por webhook → sem mTLS.
  async createPixCheckout(name: string, email: string, phone: string): Promise<{ ok: true; phone: string }> {
    if (await this.usersService.findByEmail(email)) {
      throw new BadRequestException('E-mail já cadastrado. Entre em contato ou use outro e-mail.');
    }
    if (!phone) throw new BadRequestException('WhatsApp é obrigatório para enviar o PIX');

    const billingDay = new Date().getDate();
    const tenant = await this.configRepo.save(this.configRepo.create({
      displayName: name,
      profileName: name,
      agentType: 'megahair',
      isActive: false,     // ativado só após confirmação do pagamento (polling)
      connected: false,
      paymentMethod: 'pix',
      planStatus: 'pending',
      billingPhone: phone,
      billingDay,
    }));

    // Cria usuário já com senha temporária. Senha real só é gerada/enviada após pagamento.
    const tempPassword = this._generatePassword();
    await this.usersService.create({ email, password: tempPassword, name, tenantId: tenant.id, role: 'operator' });

    // Dispara em background — não bloqueia a resposta ao cliente.
    void this._sendCheckoutPix(tenant.id, name, phone, email);

    return { ok: true, phone };
  }

  // Gera o QR na Efí Bank e envia pela API oficial da Meta (template pix_mensal_v7).
  // Roda em background (pode levar ~2 min). Se falhar, limpa o tenant fantasma e avisa o cliente.
  private async _sendCheckoutPix(tenantId: string, name: string, phone: string, email: string): Promise<void> {
    const txid = tenantId.replace(/-/g, ''); // 32 hex chars
    const valor = '490,00';
    try {
      const pix = await this._efiCreateCob(txid, `Plano Convert Hair - ${name}`, valor.replace(',', '.'));
      this.logger.log(`[EFI] QR de checkout gerado txid=${txid} (${email})`);

      const mediaId = await this._uploadMetaMedia(pix.qrCode);
      await this._sendMetaTemplate(phone, 'pix_mensal_v7', [
        { type: 'header', parameters: [{ type: 'image', image: { id: mediaId } }] },
        { type: 'body', parameters: [{ type: 'text', text: valor }, { type: 'text', text: pix.pixCode }] },
      ]);
    } catch (err) {
      this.logger.error(`[EFI] Falha ao gerar/enviar QR de checkout (tenant ${tenantId}): ${err.message}`);
      // Limpa o tenant fantasma para liberar o e-mail e permitir nova tentativa
      const users = await this.usersService.findByTenant(tenantId);
      for (const u of users) await this.usersService.resetPassword(u.id, '_disabled_');
      await this.configRepo.delete(tenantId);
      await this._sendText(phone, `Ops! Tivemos um problema ao gerar seu PIX. 😕 Por favor, tente novamente em instantes.`);
    }
  }

  // ───────────────────────── Implantação (taxa única R$400, sem conta) ─────────────────────────

  async createImplantacaoCheckout(name: string, phone: string): Promise<{ ok: true; phone: string }> {
    if (!phone) throw new BadRequestException('WhatsApp é obrigatório');

    const payment = await this.implantacaoRepo.save(this.implantacaoRepo.create({ name, phone, status: 'pending' }));
    void this._sendImplantacaoPix(payment.id, name, phone);
    return { ok: true, phone };
  }

  // Gera o QR na Efí Bank e envia pela API oficial da Meta (template implantacao_v1).
  private async _sendImplantacaoPix(paymentId: string, name: string, phone: string): Promise<void> {
    const txid = paymentId.replace(/-/g, '');
    try {
      const pix = await this._efiCreateCob(txid, `Implantação Convert Hair - ${name}`, '400.00');
      this.logger.log(`[EFI] QR implantação gerado txid=${txid}`);

      const mediaId = await this._uploadMetaMedia(pix.qrCode);
      await this._sendMetaTemplate(phone, 'implantacao_v1', [
        { type: 'header', parameters: [{ type: 'image', image: { id: mediaId } }] },
        { type: 'body', parameters: [
          { type: 'text', text: name },
          { type: 'text', text: '400,00' },
          { type: 'text', text: pix.pixCode },
        ] },
      ]);
    } catch (err) {
      this.logger.error(`[EFI] Falha ao gerar/enviar QR implantação (payment ${paymentId}): ${err.message}`);
      await this.implantacaoRepo.update(paymentId, { status: 'expired' });
      await this._sendText(phone, `Ops! Tivemos um problema ao gerar seu PIX. 😕 Por favor, tente novamente em instantes.`);
    }
  }

  private async _activatePaidImplantacao(payment: ImplantacaoPayment): Promise<void> {
    const claim = await this.implantacaoRepo
      .createQueryBuilder()
      .update(ImplantacaoPayment)
      .set({ status: 'paid' })
      .where('id = :id AND status = :pending', { id: payment.id, pending: 'pending' })
      .execute();

    if (claim.affected !== 1) return;

    const msg =
      `🎉 Pagamento de implantação confirmado, ${payment.name}!\n\n` +
      `Em breve nossa equipe entrará em contato para configurar seu sistema *Convert Hair*. 🚀\n\n` +
      `Obrigado pela confiança! 🙏`;
    await this._sendText(payment.phone, msg);
    this.logger.log(`[EFI] Implantação paga → payment ${payment.id} CONFIRMADO`);
  }

  // ───────────────────────── Polling de pagamentos PIX (substitui o webhook) ─────────────────────────

  // A cada minuto, consulta a Efí Bank pelo status das cobranças pendentes.
  // Quando CONCLUIDA → ativa a conta e envia credenciais. Sem webhook = sem mTLS.
  @Cron(CronExpression.EVERY_MINUTE)
  async pollPendingPix(): Promise<void> {
    if (!this.config.get<string>('EFI_CLIENT_ID')) return; // Efí não configurada

    // Polling plano mensal (tenants pendentes)
    const pendings = await this.configRepo.find({
      where: { paymentMethod: 'pix', planStatus: In(['pending', 'past_due']) },
    });
    for (const tenant of pendings) {
      const txid = tenant.id.replace(/-/g, '');
      let status: string | null;
      try {
        status = await this._efiGetCobStatus(txid);
      } catch (err) {
        this.logger.error(`[EFI] Polling falhou para tenant ${tenant.id}: ${err.message}`);
        continue;
      }
      if (status === 'CONCLUIDA') {
        await this._activatePaidTenant(tenant);
      } else if (status === 'EXPIRADA') {
        tenant.planStatus = 'expired';
        await this.configRepo.save(tenant);
        this.logger.log(`[EFI] PIX expirado → tenant ${tenant.id} marcado como expired`);
      }
    }

    // Polling implantações pendentes
    const implantacoes = await this.implantacaoRepo.find({ where: { status: 'pending' } });
    for (const payment of implantacoes) {
      const txid = payment.id.replace(/-/g, '');
      let status: string | null;
      try {
        status = await this._efiGetCobStatus(txid);
      } catch (err) {
        this.logger.error(`[EFI] Polling implantação falhou para ${payment.id}: ${err.message}`);
        continue;
      }
      if (status === 'CONCLUIDA') {
        await this._activatePaidImplantacao(payment);
      } else if (status === 'EXPIRADA') {
        await this.implantacaoRepo.update(payment.id, { status: 'expired' });
        this.logger.log(`[EFI] PIX implantação expirado → payment ${payment.id}`);
      }
    }
  }

  // Ativa o tenant após pagamento confirmado.
  // Usa UPDATE atômico (pending → active) para evitar duplicação em múltiplas instâncias.
  private async _activatePaidTenant(tenant: WhatsappConfig): Promise<void> {
    const claim = await this.configRepo
      .createQueryBuilder()
      .update(WhatsappConfig)
      .set({ isActive: true, planStatus: 'active', lastPixSentAt: new Date() })
      .where('id = :id AND plan_status = :pending', { id: tenant.id, pending: 'pending' })
      .execute();

    if (claim.affected !== 1) return; // já ativado por outra instância

    // Primeira ativação: gera senha definitiva e envia credenciais
    const users = await this.usersService.findByTenant(tenant.id);
    const user = users[0];
    if (user) {
      const password = this._generatePassword();
      await this.usersService.resetPassword(user.id, password);
      if (tenant.billingPhone) await this._sendCredentials(tenant.billingPhone, user.email, password);
    }
    this.logger.log(`[EFI] Pagamento confirmado → tenant ${tenant.id} ATIVADO + credenciais enviadas`);
  }

  // ───────────────────────── Efí Bank PIX — Webhook (fallback, exige mTLS) ─────────────────────────

  async handleEfiWebhook(body: any): Promise<{ received: boolean }> {
    if (body?.evento === 'teste_webhook') {
      this.logger.log('[EFI] Webhook de teste recebido ✅');
      return { received: true };
    }
    const pixList: Array<{ txid?: string }> = body?.pix ?? [];
    for (const pix of pixList) {
      if (!pix.txid || pix.txid.length !== 32) continue;
      const raw = pix.txid;
      const tenantId = `${raw.slice(0,8)}-${raw.slice(8,12)}-${raw.slice(12,16)}-${raw.slice(16,20)}-${raw.slice(20)}`;
      const tenant = await this.configRepo.findOne({ where: { id: tenantId } });
      if (!tenant) {
        this.logger.warn(`[EFI] Tenant não encontrado para txid=${raw}`);
        continue;
      }
      await this._activatePaidTenant(tenant);
    }
    return { received: true };
  }

  // ───────────────────────── PIX mensal (chamado pelo BillingReminderService) ─────────────────────────

  async generateAndSendMonthlyPix(tenant: WhatsappConfig): Promise<void> {
    if (!tenant.billingPhone) return;
    const valor = '490,00'; // TODO: puxar de tenant.planValue quando existir valor variável por cliente

    try {
      const txid = tenant.id.replace(/-/g, '');
      const pix = await this._efiCreateCob(txid, `Renovação plano Convert Hair`, valor.replace(',', '.'));
      this.logger.log(`[EFI] QR mensal gerado para tenant ${tenant.id}`);

      const mediaId = await this._uploadMetaMedia(pix.qrCode);
      await this._sendMetaTemplate(tenant.billingPhone, 'pix_mensal_v3', [
        { type: 'header', parameters: [{ type: 'image', image: { id: mediaId } }] },
        { type: 'body', parameters: [{ type: 'text', text: valor }, { type: 'text', text: pix.pixCode }] },
      ]);
    } catch (err) {
      this.logger.error(`[EFI] Falha ao gerar QR mensal (tenant ${tenant.id}): ${err.message}`);
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

  // Envia imagem via uazapi. `image` pode ser URL ou base64 (data:image/png;base64,...).
  private async _sendImage(phone: string, image: string, caption: string): Promise<void> {
    const baseUrl = this.config.get<string>('UAZAPI_BASE_URL') ?? '';
    const token = await this._resolveSenderToken();
    try {
      await firstValueFrom(
        this.http.post(
          `${baseUrl}/send/media`,
          { number: phone, type: 'image', file: image, text: caption },
          { headers: { token } },
        ),
      );
    } catch (err) {
      this.logger.error(`[PAYMENTS] Falha ao enviar imagem para ${phone} [HTTP ${err?.response?.status ?? 'N/A'}]: ${err.message}`);
    }
  }

  // ───────────────────────── API Oficial Meta (cobrança/lembrete) ─────────────────────────
  // Número da Convert Hair na WhatsApp Cloud API — separado do WHATSAPP_PROVIDER por tenant
  // (que continua uazapi pro atendimento normal dos clientes).

  private readonly metaApiBase = 'https://graph.facebook.com/v20.0';

  // Telefone da Efí/uazapi às vezes vem sem o "55" na frente — a Cloud API exige DDI completo.
  private _normalizePhoneMeta(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.startsWith('55')) return digits;
    if (digits.length === 10 || digits.length === 11) return `55${digits}`;
    return digits;
  }

  // Sobe a imagem (base64 "data:image/png;base64,...") pra Meta e retorna o media_id.
  private async _uploadMetaMedia(base64DataUrl: string): Promise<string> {
    const phoneNumberId = this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID');
    const token = this.config.get<string>('WHATSAPP_TOKEN');
    const match = /^data:(image\/\w+);base64,(.+)$/.exec(base64DataUrl);
    if (!match) throw new Error('Formato de imagem base64 inválido');
    const [, mimeType, b64] = match;
    const buffer = Buffer.from(b64, 'base64');

    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', mimeType);
    form.append('file', buffer, { filename: 'qrcode.png', contentType: mimeType });

    const res = await firstValueFrom(
      this.http.post(`${this.metaApiBase}/${phoneNumberId}/media`, form, {
        headers: { Authorization: `Bearer ${token}`, ...form.getHeaders() },
      }),
    );
    return (res.data as any).id;
  }

  // Envia mensagem de template aprovado pela Meta (mensagem iniciada pela empresa).
  private async _sendMetaTemplate(
    phone: string,
    templateName: string,
    components: any[],
  ): Promise<void> {
    const phoneNumberId = this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID');
    const token = this.config.get<string>('WHATSAPP_TOKEN');
    const to = this._normalizePhoneMeta(phone);
    try {
      await firstValueFrom(
        this.http.post(
          `${this.metaApiBase}/${phoneNumberId}/messages`,
          {
            messaging_product: 'whatsapp',
            to,
            type: 'template',
            template: { name: templateName, language: { code: 'pt_BR' }, components },
          },
          { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
        ),
      );
    } catch (err) {
      this.logger.error(
        `[PAYMENTS] Falha ao enviar template "${templateName}" para ${to} [HTTP ${err?.response?.status ?? 'N/A'}]: ${JSON.stringify(err?.response?.data ?? err.message)}`,
      );
    }
  }

  async listOverdue(): Promise<WhatsappConfig[]> {
    return this.configRepo.find({ where: { planStatus: 'past_due' } });
  }
}
