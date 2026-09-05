import * as https from 'https';
import { randomUUID } from 'crypto';
import { Injectable, Logger, BadRequestException, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import Stripe from 'stripe';
import { Resend } from 'resend';
import FormData = require('form-data');
// Sob `module: nodenext` o Stripe resolve para os tipos CJS (export = StripeConstructor),
// que não expõem o namespace rico (Stripe.Checkout, etc). Os objetos de evento do webhook
// são tipados como `any` aqui — o runtime não é afetado.
import { WhatsappConfig } from '../common/entities/whatsapp-config.entity';
import { ImplantacaoPayment } from '../common/entities/implantacao-payment.entity';
import { CheckoutSettings } from '../common/entities/checkout-settings.entity';
import { BillingEvent } from '../common/entities/billing-event.entity';
import { UsersService } from '../auth/users.service';
import { PixQueueService } from './pix-queue.service';
import { QUEUE_ENGINE_BULLMQ } from '../queue/queue.constants';
import { FinanceiroWhatsappService } from '../financeiro-whatsapp/financeiro-whatsapp.service';
import { OnboardingService } from '../onboarding/onboarding.service';

const CURRENCY = 'brl';

export interface CheckoutResult {
  url?: string; // cartão: redirecionar para Stripe
}

// UTM capturado na URL do checkout. Opcional em todo lugar: quando o link não vem taggeado,
// a origem é preenchida depois pelo sync com o convertHairCRM (tela Financeiro do Admin).
export interface ClientOrigin {
  originSource?: string | null;
  originMedium?: string | null;
  originCampaign?: string | null;
}

@Injectable()
export class PaymentsService implements OnModuleInit {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly stripe: any;
  private readonly resend: Resend | null;
  private _efiTokenCache: { token: string; expiresAt: number } | null = null;

  // Polling sob demanda: o cron roda a cada minuto, mas só toca no banco quando há
  // cobrança pendente de verdade. Acorda em _wakePolling() (toda geração de PIX) e
  // volta a dormir sozinho quando não sobra nada pendente.
  private _pollingActive = false;
  private _lastDeepCheckAt = 0;
  // Rede de segurança: mesmo dormindo, revalida no banco de tempos em tempos. Cobre
  // o caso de outra instância ter gerado o PIX (o flag é por processo) e o de um
  // pending criado fora dos fluxos que chamam _wakePolling().
  private static readonly DEEP_CHECK_INTERVAL_MS = 30 * 60 * 1000;

  // Prazo pra pagar um PIX gerado (checkout, implantação ou renovação). Passou disso →
  // expira localmente em pollPendingPix, independente do que a Efí retornar.
  private static readonly PIX_EXPIRATION_SECONDS = 6 * 60 * 60; // 6h
  private static readonly PIX_EXPIRATION_MS = PaymentsService.PIX_EXPIRATION_SECONDS * 1000;

  constructor(
    @InjectRepository(WhatsappConfig)
    private readonly configRepo: Repository<WhatsappConfig>,
    @InjectRepository(ImplantacaoPayment)
    private readonly implantacaoRepo: Repository<ImplantacaoPayment>,
    @InjectRepository(CheckoutSettings)
    private readonly checkoutSettingsRepo: Repository<CheckoutSettings>,
    @InjectRepository(BillingEvent)
    private readonly billingEventRepo: Repository<BillingEvent>,
    private readonly config: ConfigService,
    private readonly http: HttpService,
    private readonly usersService: UsersService,
    // Último parâmetro de propósito: polling.spec.ts instancia o serviço por posição.
    private readonly pixQueue: PixQueueService,
    // Opcional — specs antigos instanciam o serviço por posição sem esse param.
    private readonly financeiroWhatsappService?: FinanceiroWhatsappService,
    // Idem: opcional e no fim pra não quebrar os specs que instanciam por posição.
    private readonly onboarding?: OnboardingService,
  ) {
    const stripeKey = this.config.get<string>('STRIPE_SECRET_KEY');
    this.stripe = stripeKey ? new Stripe(stripeKey) : null;
    const resendKey = this.config.get<string>('RESEND_API_KEY');
    this.resend = resendKey ? new Resend(resendKey) : null;
  }

  private get _queueMode(): boolean {
    return this.config.get<string>('QUEUE_ENGINE') === QUEUE_ENGINE_BULLMQ;
  }

  // Chamado sempre que um PIX é gerado. No modo fila abre a cadeia de checagens dessa
  // cobrança; no legado só acorda o cron. Os dois caminhos coexistem para o rollback
  // ser uma troca de env var, sem redeploy.
  private async _onPixCreated(kind: 'tenant' | 'implantacao', id: string, txid: string): Promise<void> {
    if (this._queueMode) {
      await this.pixQueue.startCheckChain(kind, id, txid);
      return;
    }
    this._wakePolling();
  }

  // No boot (deploy/restart), retoma o polling se já houver cobrança pendente —
  // senão um PIX gerado antes do restart nunca seria confirmado.
  async onModuleInit(): Promise<void> {
    if (!this.config.get<string>('EFI_CLIENT_ID')) return;
    try {
      // No modo fila, reabre a cadeia de cada pendência (o equivalente ao _pollingActive
      // do legado, mas por cobrança). jobId estável evita duplicar cadeia já existente.
      if (this._queueMode) {
        const { tenants, implantacoes } = await this.listPendingPixTargets();
        for (const t of tenants) await this.pixQueue.startCheckChain('tenant', t.id, t.txid);
        for (const p of implantacoes) await this.pixQueue.startCheckChain('implantacao', p.id, p.txid);
        const total = tenants.length + implantacoes.length;
        if (total > 0) this.logger.log(`[EFI][queue] ${total} cobrança(s) pendente(s) reenfileirada(s) no boot`);
        return;
      }
      if (await this._hasPendingCharges()) {
        this._pollingActive = true;
        this.logger.log('[EFI] Cobranças pendentes no boot → polling ativado');
      }
    } catch (err) {
      // Banco indisponível no boot não pode derrubar a aplicação: o deep check
      // (a cada 30min) reativa o polling na primeira varredura bem-sucedida.
      this.logger.error(`[EFI] Falha ao checar pendências no boot: ${err.message}`);
    }
  }

  private async _hasPendingCharges(): Promise<boolean> {
    const pendings = await this.configRepo.count({
      where: { paymentMethod: 'pix', planStatus: In(['pending', 'past_due']) },
    });
    if (pendings > 0) return true;
    return (await this.implantacaoRepo.count({ where: { status: 'pending' } })) > 0;
  }

  // Chamado sempre que um PIX é gerado (checkout, implantação ou renovação mensal).
  private _wakePolling(): void {
    if (this._pollingActive) return;
    this._pollingActive = true;
    this.logger.log('[EFI] Polling de PIX ativado (nova cobrança pendente)');
  }

  // ───────────────────────── Configurações do checkout (admin) ─────────────────────────

  // Linha única (id=1) — cria com defaults se ainda não existir (proteção extra além da migration).
  async getCheckoutSettings(): Promise<CheckoutSettings> {
    let settings = await this.checkoutSettingsRepo.findOne({ where: { id: 1 } });
    if (!settings) {
      settings = await this.checkoutSettingsRepo.save(this.checkoutSettingsRepo.create({ id: 1 }));
    }
    return settings;
  }

  async updateCheckoutSettings(body: {
    pixEnabled?: boolean;
    cardEnabled?: boolean;
    implantacaoEnabled?: boolean;
    planoEnabled?: boolean;
    implantacaoPrice?: number;
    planoPrice?: number;
  }): Promise<CheckoutSettings> {
    const settings = await this.getCheckoutSettings();
    if (body.pixEnabled !== undefined) settings.pixEnabled = body.pixEnabled;
    if (body.cardEnabled !== undefined) settings.cardEnabled = body.cardEnabled;
    if (body.implantacaoEnabled !== undefined) settings.implantacaoEnabled = body.implantacaoEnabled;
    if (body.planoEnabled !== undefined) settings.planoEnabled = body.planoEnabled;
    if (body.implantacaoPrice !== undefined) {
      const implantacaoPrice = Number(body.implantacaoPrice);
      if (!Number.isFinite(implantacaoPrice) || implantacaoPrice <= 0) throw new BadRequestException('Valor da implantação deve ser maior que zero');
      settings.implantacaoPrice = implantacaoPrice.toFixed(2);
    }
    if (body.planoPrice !== undefined) {
      const planoPrice = Number(body.planoPrice);
      if (!Number.isFinite(planoPrice) || planoPrice <= 0) throw new BadRequestException('Valor do plano deve ser maior que zero');
      settings.planoPrice = planoPrice.toFixed(2);
    }
    return this.checkoutSettingsRepo.save(settings);
  }

  // ───────────────────────── Checkout (público) ─────────────────────────

  async createCardCheckout(name: string, email: string, phone: string, origin?: ClientOrigin): Promise<CheckoutResult> {
    const settings = await this.getCheckoutSettings();
    if (!settings.planoEnabled) throw new BadRequestException('Plano mensal está desabilitado no momento.');
    if (!settings.cardEnabled) throw new BadRequestException('Pagamento por cartão está desabilitado no momento.');
    if (!this.stripe) throw new BadRequestException('Checkout por cartão não configurado (STRIPE_SECRET_KEY ausente)');
    const priceId = this.config.get<string>('STRIPE_PRICE_ID_MONTHLY');
    const frontendUrl = this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:5173';
    if (!priceId) throw new BadRequestException('STRIPE_PRICE_ID_MONTHLY não configurado');

    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: email,
      // A origem viaja no metadata porque a conta só é criada lá no webhook
      // (checkout.session.completed) — é o único jeito de o UTM sobreviver até lá.
      metadata: {
        name,
        phone,
        method: 'card',
        originSource: origin?.originSource ?? '',
        originMedium: origin?.originMedium ?? '',
        originCampaign: origin?.originCampaign ?? '',
      },
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
      case 'invoice.payment_succeeded':
        await this._onInvoicePaid(event.data.object);
        break;
      case 'invoice.payment_failed':
        await this._onInvoiceFailed(event.data.object);
        break;
      case 'payment_intent.payment_failed':
        await this._onPaymentIntentFailed(event.data.object);
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
      // Metadata do Stripe só guarda string — '' vira null aqui.
      originSource: meta.originSource || null,
      originMedium: meta.originMedium || null,
      originCampaign: meta.originCampaign || null,
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

  // Avisa o admin (ADMIN_ALERT_PHONE) na hora quando um pagamento por cartão falha —
  // seja na 1ª tentativa (checkout ainda nem virou assinatura, ex.: 3D Secure recusado
  // pelo banco) ou numa renovação. Sem isso, um cliente que realmente tentou pagar e
  // falhou simplesmente não aparece em lugar nenhum — parecia que o cadastro "sumiu",
  // quando na verdade o Stripe nunca recebeu o dinheiro (motivo: erro do 04/09/2026,
  // caso Eliene da Silva/mariednasilvaandrade@gmail.com).
  // Manda pros dois canais — não é fallback um do outro, os dois são independentes:
  // WhatsApp é pra ver na hora, e-mail fica registrado (histórico) mesmo se o número
  // de WhatsApp estiver restrito (já aconteceu — ver commit anterior).
  private async _onPaymentIntentFailed(pi: any): Promise<void> {
    try {
      const adminPhone = this.config.get<string>('ADMIN_ALERT_PHONE');
      const adminEmail = this.config.get<string>('ADMIN_ALERT_EMAIL');
      if (!adminPhone && !adminEmail) return;

      const billing = pi.last_payment_error?.payment_method?.billing_details ?? {};
      const clientName = billing.name || pi.metadata?.name || 'Nome não informado';
      const clientEmail = billing.email || pi.receipt_email || 'e-mail não informado';
      const amount = typeof pi.amount === 'number' ? (pi.amount / 100).toFixed(2).replace('.', ',') : '?';
      const reason = pi.last_payment_error?.message || 'motivo não informado pelo Stripe';
      const isRenewal = Boolean(pi.invoice);
      const kind = isRenewal ? 'renovação' : '1ª cobrança — checkout';

      if (adminPhone) {
        const alertText =
          `🔴 *Pagamento por cartão falhou (${kind})*\n\n` +
          `Nome: *${clientName}*\n` +
          `E-mail: ${clientEmail}\n` +
          `Valor tentado: R$ ${amount}\n` +
          `Motivo: ${reason}\n\n` +
          `Nenhuma cobrança foi efetivada — não vai aparecer em Clientes/Cobranças até ela tentar de novo com sucesso.`;
        const sent = await this._sendText(adminPhone, alertText);
        if (sent) {
          this.logger.warn(`[STRIPE] Pagamento falhou (pi ${pi.id}) — alerta enviado pro admin via WhatsApp`);
        } else {
          this.logger.error(`[STRIPE] Pagamento falhou (pi ${pi.id}) — NÃO conseguiu avisar o admin via WhatsApp (ver erro de envio acima). Cheque manualmente.`);
        }
      }

      if (adminEmail) {
        await this._sendPaymentFailureEmail(adminEmail, { clientName, clientEmail, amount, reason, kind, piId: pi.id });
      }
    } catch (err) {
      this.logger.error(`[STRIPE] Falha ao processar/alertar payment_intent.payment_failed: ${err.message}`);
    }
  }

  // Renovação mensal do cartão paga com sucesso. O Stripe cobra sozinho e, até aqui, NADA
  // disso entrava no banco: a receita de cartão parava na 1ª cobrança e a data de vencimento
  // exibida nunca avançava. Registra o pagamento e empurra o próximo vencimento em 1 mês.
  private async _onInvoicePaid(invoice: any): Promise<void> {
    try {
      const subscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
      const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
      if (!subscriptionId && !customerId) return;

      const tenant = subscriptionId
        ? await this.configRepo.findOne({ where: { stripeSubscriptionId: subscriptionId } })
        : await this.configRepo.findOne({ where: { stripeCustomerId: customerId } });
      if (!tenant) {
        this.logger.warn(`[STRIPE] invoice.payment_succeeded sem tenant correspondente (sub ${subscriptionId ?? '-'} / cus ${customerId ?? '-'})`);
        return;
      }

      // A 1ª fatura da assinatura é a mesma cobrança que _createClientFromPayment já registrou
      // no checkout — registrar de novo duplicaria a receita do cliente.
      if (invoice.billing_reason === 'subscription_create') {
        this.logger.log(`[STRIPE] 1ª fatura da assinatura ${subscriptionId} — já registrada no checkout, ignorando`);
        return;
      }

      const amount = typeof invoice.amount_paid === 'number' ? invoice.amount_paid / 100 : Number(tenant.planValue ?? '397.00');
      await this._logBillingEvent(tenant.id, 'pagamento', 'confirmado', amount, invoice.id ?? null, undefined, tenant.displayName ?? undefined);

      tenant.planStatus = 'active';
      tenant.nextPaymentDate = this._addOneMonth(new Date());
      await this.configRepo.save(tenant);

      this.logger.log(`[STRIPE] Renovação de cartão confirmada → tenant ${tenant.id} (R$ ${amount.toFixed(2)}), próximo vencimento ${tenant.nextPaymentDate.toISOString().slice(0, 10)}`);
    } catch (err) {
      this.logger.error(`[STRIPE] Falha ao processar invoice.payment_succeeded: ${err.message}`);
    }
  }

  // Avisa o convertHairCRM que um cliente novo pagou (1ª ativação, nunca renovação) pra ele
  // atribuir o evento Purchase ao lead de origem automaticamente — sem isso, alguém tinha
  // que entrar lá e clicar em "Converter Lead" na mão pra cada venda. Nunca bloqueia a
  // ativação da conta: qualquer falha aqui (rede, config faltando, etc.) só loga e segue.
  private async _notifyConvertHairCrmPurchase(phone: string | null, value: number, clientName: string): Promise<void> {
    if (!phone) return;
    const baseUrl = this.config.get<string>('CONVERTHAIRCRM_API_URL');
    const token = this.config.get<string>('INTERNAL_API_TOKEN');
    if (!baseUrl || !token) {
      this.logger.warn('[AUTO-CONVERT] CONVERTHAIRCRM_API_URL ou INTERNAL_API_TOKEN não configurados — pulando atribuição automática');
      return;
    }
    try {
      const res = await firstValueFrom(
        this.http.post(
          `${baseUrl.replace(/\/$/, '')}/leads/auto-convert`,
          { phone, value },
          { headers: { 'x-internal-token': token } },
        ),
      );
      const data = res.data as { matched: boolean; alreadyConverted?: boolean; leadId?: string };
      if (data.matched) {
        this.logger.log(`[AUTO-CONVERT] Purchase atribuído ao lead ${data.leadId} do convertHairCRM (${clientName})`);
      } else {
        this.logger.warn(`[AUTO-CONVERT] Nenhum lead encontrado no convertHairCRM pro telefone de ${clientName} — avisando por e-mail`);
        await this._sendNoMatchAlertEmail(clientName, phone, value);
      }
    } catch (err) {
      this.logger.error(`[AUTO-CONVERT] Falha ao notificar convertHairCRM (${clientName}): ${err.message}`);
    }
  }

  private async _sendNoMatchAlertEmail(clientName: string, phone: string, value: number): Promise<void> {
    const adminEmail = this.config.get<string>('ADMIN_ALERT_EMAIL');
    if (!adminEmail || !this.resend) return;
    const from = this.config.get<string>('RESEND_FROM_EMAIL') ?? 'Convert Hair <onboarding@resend.dev>';
    try {
      await this.resend.emails.send({
        from,
        to: adminEmail,
        subject: `⚠️ Venda sem lead de origem — ${clientName}`,
        html: `
          <div style="font-family: sans-serif; font-size: 14px; color: #1f1f1f; line-height: 1.6;">
            <p><strong>${clientName}</strong> pagou R$ ${value.toFixed(2)}, mas nenhum lead com esse telefone foi encontrado no convertHairCRM.</p>
            <p>Telefone do checkout: <strong>${phone}</strong></p>
            <p>Pode ser que o número digitado no cadastro seja diferente do que entrou no grupo do WhatsApp — vale conferir manualmente e, se achar o lead certo, converter na mão por lá.</p>
          </div>
        `,
      });
    } catch (err) {
      this.logger.error(`[AUTO-CONVERT] Falha ao enviar e-mail de alerta (sem lead correspondente) pra ${clientName}: ${err.message}`);
    }
  }

  private async _sendPaymentFailureEmail(
    to: string,
    info: { clientName: string; clientEmail: string; amount: string; reason: string; kind: string; piId: string },
  ): Promise<void> {
    if (!this.resend) {
      this.logger.warn('[EMAIL] RESEND_API_KEY não configurada — pulando alerta de pagamento falho por e-mail');
      return;
    }
    const from = this.config.get<string>('RESEND_FROM_EMAIL') ?? 'Convert Hair <onboarding@resend.dev>';
    try {
      await this.resend.emails.send({
        from,
        to,
        subject: `🔴 Pagamento falhou — ${info.clientName} (${info.kind})`,
        html: `
          <div style="font-family: sans-serif; font-size: 14px; color: #1f1f1f; line-height: 1.6;">
            <h2 style="color: #dc2626;">Pagamento por cartão falhou</h2>
            <p><strong>Tipo:</strong> ${info.kind}</p>
            <p><strong>Nome:</strong> ${info.clientName}</p>
            <p><strong>E-mail:</strong> ${info.clientEmail}</p>
            <p><strong>Valor tentado:</strong> R$ ${info.amount}</p>
            <p><strong>Motivo:</strong> ${info.reason}</p>
            <p><strong>Payment Intent:</strong> ${info.piId}</p>
            <p style="color: #6b7280; margin-top: 20px;">Nenhuma cobrança foi efetivada — não vai aparecer em Clientes/Cobranças até ela tentar de novo com sucesso.</p>
          </div>`,
      });
      this.logger.log(`[EMAIL] Alerta de pagamento falho enviado para ${to}`);
    } catch (err) {
      this.logger.error(`[EMAIL] Falha ao enviar alerta de pagamento falho para ${to}: ${err.message}`);
    }
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
  private async _efiCreateCob(txid: string, descricao: string, amount = '390.00'): Promise<{ qrCode: string; pixCode: string }> {
    const pixKey = this.config.get<string>('EFI_PIX_KEY');
    if (!pixKey) throw new BadRequestException('EFI_PIX_KEY não configurada');

    const token = await this._efiToken();
    const agent = this._efiAgent();
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    // 6h: depois disso o banco do pagador recusa o pagamento. A Efí NÃO expira o status
    // sozinha (cobrança fica "ATIVA" pra sempre do lado dela) — pollPendingPix expira
    // localmente usando esse mesmo prazo, com base em lastPixSentAt/createdAt.
    const cobR = await firstValueFrom(
      this.http.put(
        `${this._efiBaseUrl}/v2/cob/${txid}`,
        { calendario: { expiracao: PaymentsService.PIX_EXPIRATION_SECONDS }, valor: { original: amount }, chave: pixKey, solicitacaoPagador: descricao },
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
  async createPixCheckout(name: string, email: string, phone: string, origin?: ClientOrigin): Promise<{ ok: true; phone: string }> {
    const settings = await this.getCheckoutSettings();
    if (!settings.planoEnabled) throw new BadRequestException('Plano mensal está desabilitado no momento.');
    if (!settings.pixEnabled) throw new BadRequestException('Pagamento por PIX está desabilitado no momento.');
    if (await this.usersService.findByEmail(email)) {
      throw new BadRequestException('E-mail já cadastrado. Entre em contato ou use outro e-mail.');
    }
    if (!phone) throw new BadRequestException('WhatsApp é obrigatório para enviar o PIX');

    const now = new Date();
    const billingDay = now.getDate();
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
      nextPaymentDate: this._addOneMonth(now),
      originSource: origin?.originSource ?? null,
      originMedium: origin?.originMedium ?? null,
      originCampaign: origin?.originCampaign ?? null,
    }));

    // Cria usuário já com senha temporária. Senha real só é gerada/enviada após pagamento.
    const tempPassword = this._generatePassword();
    await this.usersService.create({ email, password: tempPassword, name, tenantId: tenant.id, role: 'operator' });

    // Dispara em background — não bloqueia a resposta ao cliente.
    void this._sendCheckoutPix(tenant.id, name, phone, email);

    return { ok: true, phone };
  }

  // Gera o QR na Efí Bank e envia pela API oficial da Meta (link pra página com QR + código).
  // Roda em background (pode levar ~2 min). Se falhar, limpa o tenant fantasma e avisa o cliente.
  private async _sendCheckoutPix(tenantId: string, name: string, phone: string, email: string): Promise<void> {
    const txid = tenantId.replace(/-/g, ''); // 32 hex chars
    const settings = await this.getCheckoutSettings();
    const valorNum = Number(settings.planoPrice);
    const valor = valorNum.toFixed(2).replace('.', ',');
    try {
      const pix = await this._efiCreateCob(txid, `Plano Convert Hair - ${name}`, valor.replace(',', '.'));
      await this._onPixCreated('tenant', tenantId, txid);
      this.logger.log(`[EFI] QR de checkout gerado txid=${txid} (${email})`);
      await this._logBillingEvent(tenantId, 'pix', 'sent', valorNum, txid, undefined, name);

      // Persiste QR+código+valor já aqui — a página pública /pix/:txid depende só do banco.
      // valorNum vem de checkoutSettings.planoPrice (não de tenant.planValue, que pode estar
      // nulo/desatualizado nesse momento) — precisa ser o valor exato usado na Efí.
      await this.configRepo.update(tenantId, {
        lastPixTxid: txid, lastPixQrCode: pix.qrCode, lastPixCode: pix.pixCode, lastPixValue: valorNum.toFixed(2),
        lastPixSentAt: new Date(),
      });

      // WhatsApp e e-mail são canais independentes — falha em um não deve impedir o outro.
      try {
        const pageUrl = this._buildPixPageUrl(txid);
        await this._sendMetaTemplate(phone, 'pix_checkout_link_v1', [
          { type: 'body', parameters: [{ type: 'text', text: name }, { type: 'text', text: valor }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: txid }] },
        ]);
        this.logger.log(`[EFI] Link de checkout: ${pageUrl}`);
        await this._logBillingEvent(tenantId, 'whatsapp', 'sent', valorNum, txid, undefined, name);
      } catch (waErr) {
        this.logger.error(`[EFI] Falha ao enviar PIX de checkout por WhatsApp (tenant ${tenantId}): ${waErr.message}`);
        await this._logBillingEvent(tenantId, 'whatsapp', 'failed', valorNum, txid, waErr.message, name);
      }
      const result = await this._sendPixEmail(email, name, 'Plano Mensal', valor, pix, 'Assinatura mensal do plano Convert Hair.');
      await this._logBillingEvent(tenantId, 'email', result.ok ? 'sent' : 'failed', valorNum, txid, result.error, name);
    } catch (err) {
      this.logger.error(`[EFI] Falha ao gerar/enviar QR de checkout (tenant ${tenantId}): ${err.message}`);
      await this._logBillingEvent(tenantId, 'pix', 'failed', valorNum, null, err.message, name);
      // Limpa o tenant fantasma para liberar o e-mail e permitir nova tentativa
      const users = await this.usersService.findByTenant(tenantId);
      for (const u of users) await this.usersService.resetPassword(u.id, '_disabled_');
      await this.configRepo.delete(tenantId);
      await this._sendText(phone, `Ops! Tivemos um problema ao gerar seu PIX. 😕 Por favor, tente novamente em instantes.`);
    }
  }

  // ───────────────────────── Implantação (taxa única R$400, sem conta) ─────────────────────────

  async createImplantacaoCheckout(name: string, phone: string, email: string): Promise<{ ok: true; phone: string }> {
    const settings = await this.getCheckoutSettings();
    if (!settings.implantacaoEnabled) throw new BadRequestException('Cobrança de implantação está desabilitada no momento.');
    if (!phone) throw new BadRequestException('WhatsApp é obrigatório');
    if (!email) throw new BadRequestException('E-mail é obrigatório');

    // Congela o valor cobrado na própria linha: o preço em checkout_settings pode mudar
    // depois, e a receita histórica precisa refletir o que foi realmente cobrado.
    const payment = await this.implantacaoRepo.save(
      this.implantacaoRepo.create({ name, phone, email, status: 'pending', amount: Number(settings.implantacaoPrice).toFixed(2) }),
    );
    void this._sendImplantacaoPix(payment.id, name, phone, email);
    return { ok: true, phone };
  }

  // Gera o QR na Efí Bank e envia pela API oficial da Meta (template implantacao_v1) + e-mail (Resend).
  private async _sendImplantacaoPix(paymentId: string, name: string, phone: string, email: string | null): Promise<void> {
    const txid = paymentId.replace(/-/g, '');
    const settings = await this.getCheckoutSettings();
    const valorTextoNum = Number(settings.implantacaoPrice);
    const valorNum = valorTextoNum.toFixed(2);
    const valorTexto = valorNum.replace('.', ',');
    try {
      const pix = await this._efiCreateCob(txid, `Implantação Convert Hair - ${name}`, valorNum);
      await this._onPixCreated('implantacao', paymentId, txid);
      this.logger.log(`[EFI] QR implantação gerado txid=${txid}`);
      await this._logBillingEvent(null, 'pix', 'sent', valorTextoNum, txid, undefined, name);

      // WhatsApp e e-mail são canais independentes — falha em um não deve impedir o outro.
      try {
        const mediaId = await this._uploadMetaMedia(pix.qrCode);
        await this._sendMetaTemplate(phone, 'implantacao_v1', [
          { type: 'header', parameters: [{ type: 'image', image: { id: mediaId } }] },
          { type: 'body', parameters: [
            { type: 'text', text: name },
            { type: 'text', text: valorTexto },
            { type: 'text', text: pix.pixCode },
          ] },
        ]);
        await this._logBillingEvent(null, 'whatsapp', 'sent', valorTextoNum, txid, undefined, name);
      } catch (waErr) {
        this.logger.error(`[EFI] Falha ao enviar PIX implantação por WhatsApp (payment ${paymentId}): ${waErr.message}`);
        await this._logBillingEvent(null, 'whatsapp', 'failed', valorTextoNum, txid, waErr.message, name);
      }
      if (email) {
        const result = await this._sendPixEmail(email, name, 'Taxa de Implantação', valorTexto, pix, 'Pagamento único para iniciar seu sistema Convert Hair.');
        await this._logBillingEvent(null, 'email', result.ok ? 'sent' : 'failed', valorTextoNum, txid, result.error, name);
      }
    } catch (err) {
      this.logger.error(`[EFI] Falha ao gerar/enviar QR implantação (payment ${paymentId}): ${err.message}`);
      await this._logBillingEvent(null, 'pix', 'failed', valorTextoNum, null, err.message, name);
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

    // Registra a implantação como receita confirmada (antes só ficava como 'pix/sent', que é
    // "QR enviado", não "pago") e tenta ligar ao tenant — sem isso a tela Financeiro não
    // conseguia atribuir a taxa de implantação a nenhum cliente.
    const valor = Number(payment.amount ?? (await this.getCheckoutSettings()).implantacaoPrice ?? 400);
    const tenantId = payment.tenantId ?? (await this._findTenantIdForImplantacao(payment));
    if (tenantId && !payment.tenantId) {
      await this.implantacaoRepo.update(payment.id, { tenantId });
    }
    await this._logBillingEvent(tenantId, 'pagamento', 'confirmado', valor, payment.id.replace(/-/g, ''), undefined, payment.name);

    const msg =
      `🎉 Pagamento de implantação confirmado, ${payment.name}!\n\n` +
      `Em breve nossa equipe entrará em contato para configurar seu sistema *Convert Hair*. 🚀\n\n` +
      `Obrigado pela confiança! 🙏`;
    await this._sendText(payment.phone, msg);
    this.logger.log(`[EFI] Implantação paga → payment ${payment.id} CONFIRMADO${tenantId ? ` (tenant ${tenantId})` : ' (sem tenant vinculado ainda)'}`);
  }

  private _isPixExpiredLocally(sentAt: Date | null | undefined): boolean {
    if (!sentAt) return false;
    return Date.now() - new Date(sentAt).getTime() > PaymentsService.PIX_EXPIRATION_MS;
  }

  // ───────────────────────── Polling de pagamentos PIX (substitui o webhook) ─────────────────────────

  // A cada minuto, consulta a Efí Bank pelo status das cobranças pendentes.
  // Quando CONCLUIDA → ativa a conta e envia credenciais. Sem webhook = sem mTLS.
  // Só varre o banco quando há cobrança pendente (_pollingActive); fora disso o tick
  // é no-op, exceto pelo deep check a cada 30min (rede de segurança).
  @Cron(CronExpression.EVERY_MINUTE)
  async pollPendingPix(): Promise<void> {
    if (this._queueMode) return; // quem checa agora é o PixPollProcessor, cobrança por cobrança
    if (!this.config.get<string>('EFI_CLIENT_ID')) return; // Efí não configurada

    if (!this._pollingActive) {
      if (Date.now() - this._lastDeepCheckAt < PaymentsService.DEEP_CHECK_INTERVAL_MS) return;
      this._lastDeepCheckAt = Date.now();
    }

    // Polling plano mensal (tenants pendentes)
    const pendings = await this.configRepo.find({
      where: { paymentMethod: 'pix', planStatus: In(['pending', 'past_due']) },
    });
    for (const tenant of pendings) {
      // lastPixTxid = txid do ciclo de renovação atual. Sem ele (cliente ainda na 1ª cobrança,
      // nunca renovou) cai no txid = tenant.id, usado no checkout inicial.
      // NUNCA usar tenant.id como fallback se lastPixTxid já existe: a cobrança de tenant.id é a
      // do cadastro, sempre CONCLUIDA — usá-la aqui reativaria o tenant sem a renovação ser paga.
      const txid = tenant.lastPixTxid ?? tenant.id.replace(/-/g, '');
      let status: string | null;
      try {
        status = await this._efiGetCobStatus(txid);
      } catch (err) {
        this.logger.error(`[EFI] Polling falhou para tenant ${tenant.id}: ${err.message}`);
        continue;
      }
      if (status === 'CONCLUIDA') {
        await this._activatePaidTenant(tenant);
      } else if (status === 'EXPIRADA' || this._isPixExpiredLocally(tenant.lastPixSentAt)) {
        // A Efí não marca a cobrança como expirada sozinha (fica "ATIVA" pra sempre do lado
        // dela) — a expiração de 6h é decidida aqui, independente do que ela retornar.
        tenant.planStatus = 'expired';
        await this.configRepo.save(tenant);
        this.logger.log(`[EFI] PIX expirado (6h) → tenant ${tenant.id} marcado como expired`);
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
      } else if (status === 'EXPIRADA' || this._isPixExpiredLocally(payment.createdAt)) {
        await this.implantacaoRepo.update(payment.id, { status: 'expired' });
        this.logger.log(`[EFI] PIX implantação expirado (6h) → payment ${payment.id}`);
      }
    }

    // Nada pendente nesta varredura → dorme até a próxima cobrança (ou o deep check).
    if (pendings.length === 0 && implantacoes.length === 0) {
      if (this._pollingActive) this.logger.log('[EFI] Sem cobranças pendentes → polling em espera');
      this._pollingActive = false;
      this._lastDeepCheckAt = Date.now();
    } else {
      this._pollingActive = true;
    }
  }

  // ───────────────────────── Reconciliação por cobrança (usada pelas filas) ─────────────────────────
  //
  // Mesma decisão do pollPendingPix, só que para UMA cobrança em vez da tabela inteira:
  // o worker recebe o id/txid e não precisa varrer nada. A lógica de negócio é a mesma
  // (_efiGetCobStatus / _activatePaid* / _isPixExpiredLocally) — só a orquestração muda.
  //
  // Sempre relê o registro do banco: a expiração é medida contra o lastPixSentAt ATUAL,
  // não contra a idade do job. Sem isso, uma cadeia iniciada num PIX antigo (ex: reenvio
  // de D-2) expiraria um PIX novo e válido gerado depois (D-1) — o UPDATE de expiração
  // não distingue qual cobrança o originou.

  async checkAndReconcileTenantPix(tenantId: string, txid: string): Promise<'confirmed' | 'expired' | 'pending'> {
    const tenant = await this.configRepo.findOne({ where: { id: tenantId } });
    // Sumiu ou já saiu de pendente (pago por outra cadeia/webhook) → nada a fazer, encerra.
    if (!tenant || !['pending', 'past_due'].includes(tenant.planStatus)) return 'confirmed';

    const status = await this._efiGetCobStatus(txid); // erro sobe: quem chama decide reagendar
    if (status === 'CONCLUIDA') {
      await this._activatePaidTenant(tenant);
      return 'confirmed';
    }
    if (status === 'EXPIRADA' || this._isPixExpiredLocally(tenant.lastPixSentAt)) {
      tenant.planStatus = 'expired';
      await this.configRepo.save(tenant);
      this.logger.log(`[EFI][queue] PIX expirado (6h) → tenant ${tenant.id}`);
      return 'expired';
    }
    return 'pending';
  }

  async checkAndReconcileImplantacaoPix(paymentId: string, txid: string): Promise<'confirmed' | 'expired' | 'pending'> {
    const payment = await this.implantacaoRepo.findOne({ where: { id: paymentId } });
    if (!payment || payment.status !== 'pending') return 'confirmed';

    const status = await this._efiGetCobStatus(txid);
    if (status === 'CONCLUIDA') {
      await this._activatePaidImplantacao(payment);
      return 'confirmed';
    }
    if (status === 'EXPIRADA' || this._isPixExpiredLocally(payment.createdAt)) {
      await this.implantacaoRepo.update(payment.id, { status: 'expired' });
      this.logger.log(`[EFI][queue] PIX implantação expirado (6h) → payment ${payment.id}`);
      return 'expired';
    }
    return 'pending';
  }

  // Alvos pendentes para o job de reconciliação periódica — equivalente às duas varreduras
  // do cron legado, mas rodando a cada 30min em vez de a cada minuto. Rede de segurança para
  // cobranças criadas fora dos fluxos que enfileiram (outra instância, insert manual, restart).
  async listPendingPixTargets(): Promise<{
    tenants: { id: string; txid: string }[];
    implantacoes: { id: string; txid: string }[];
  }> {
    const pendings = await this.configRepo.find({
      where: { paymentMethod: 'pix', planStatus: In(['pending', 'past_due']) },
    });
    const implantacoes = await this.implantacaoRepo.find({ where: { status: 'pending' } });
    return {
      // Mesmo fallback do cron: sem lastPixTxid o cliente ainda está na 1ª cobrança (checkout).
      tenants: pendings.map((t) => ({ id: t.id, txid: t.lastPixTxid ?? t.id.replace(/-/g, '') })),
      implantacoes: implantacoes.map((p) => ({ id: p.id, txid: p.id.replace(/-/g, '') })),
    };
  }

  // Ativa o tenant após pagamento confirmado.
  // Usa UPDATE atômico (pending → active) para evitar duplicação em múltiplas instâncias.
  private async _activatePaidTenant(tenant: WhatsappConfig): Promise<void> {
    const wasAlreadyActivatedBefore = tenant.isActive; // false só na 1ª cobrança (checkout); true em renovação
    const claim = await this.configRepo
      .createQueryBuilder()
      .update(WhatsappConfig)
      .set({ isActive: true, planStatus: 'active', lastPixSentAt: new Date(), nextPaymentDate: this._addOneMonth(new Date()) })
      .where('id = :id AND plan_status = :pending', { id: tenant.id, pending: 'pending' })
      .execute();

    if (claim.affected !== 1) return; // já ativado por outra instância

    // Registra a confirmação no histórico de cobrança (aba "Cobranças" no Admin) —
    // é o que dá ao painel um indicador visível de que o PIX foi efetivamente pago,
    // não só "enviado".
    await this._logBillingEvent(
      tenant.id,
      'pagamento',
      'confirmado',
      Number(tenant.planValue ?? '390.00'),
      tenant.lastPixTxid ?? tenant.id.replace(/-/g, ''),
    );

    if (!wasAlreadyActivatedBefore) {
      // Primeira ativação: gera senha definitiva e envia credenciais
      const users = await this.usersService.findByTenant(tenant.id);
      const user = users[0];
      if (user) {
        const password = this._generatePassword();
        await this.usersService.resetPassword(user.id, password);
        await this._sendCredentials(tenant.billingPhone, user.email, password, tenant.displayName ?? 'Cliente');
      }
      this.logger.log(`[EFI] Pagamento confirmado → tenant ${tenant.id} ATIVADO (1ª vez) + credenciais enviadas`);
      // Onboarding automático — só na 1ª ativação (renovação não cria grupo). Isolado em
      // try/catch: falhar em criar grupo não pode derrubar a ativação da conta.
      try {
        await this.onboarding?.createProjectGroup(tenant.id, tenant.displayName ?? 'Cliente', tenant.billingPhone);
      } catch (err) {
        this.logger.error(`[EFI] Falha no onboarding automático do tenant ${tenant.id}: ${err.message}`);
      }
      void this._notifyConvertHairCrmPurchase(tenant.billingPhone, Number(tenant.planValue ?? '390.00'), tenant.displayName ?? 'Cliente');
    } else {
      // Renovação: só confirma o pagamento, não mexe em senha/credenciais
      if (tenant.billingPhone) {
        await this._sendText(tenant.billingPhone, `🎉 Pagamento confirmado! Seu plano *Convert Hair* foi renovado com sucesso. Obrigado! 🙏`);
      }
      this.logger.log(`[EFI] Renovação confirmada → tenant ${tenant.id} reativado (sem reset de credenciais)`);
    }
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
      // Renovação (txid aleatório) → busca por lastPixTxid. 1ª cobrança (txid = tenant.id sem hífens,
      // legado) → decodifica o tenantId direto do txid.
      let tenant = await this.configRepo.findOne({ where: { lastPixTxid: raw } });
      if (!tenant) {
        const tenantId = `${raw.slice(0,8)}-${raw.slice(8,12)}-${raw.slice(12,16)}-${raw.slice(16,20)}-${raw.slice(20)}`;
        tenant = await this.configRepo.findOne({ where: { id: tenantId } });
      }
      if (!tenant) {
        this.logger.warn(`[EFI] Tenant não encontrado para txid=${raw}`);
        continue;
      }
      await this._activatePaidTenant(tenant);
    }
    return { received: true };
  }

  // ───────────────────────── PIX mensal (chamado pelo BillingReminderService) ─────────────────────────

  // Admin: dispara o PIX mensal na hora (fora da janela automática 0..2 dias, ex: janela já passou).
  async resendMonthlyPix(tenantId: string): Promise<void> {
    const tenant = await this.configRepo.findOne({ where: { id: tenantId } });
    if (!tenant) throw new BadRequestException('Cliente não encontrado');
    if (tenant.paymentMethod !== 'pix') throw new BadRequestException('Cliente não usa PIX');
    if (!tenant.billingPhone) throw new BadRequestException('Cliente sem telefone de cobrança cadastrado');
    // O reset do planStatus pra 'pending' (e do contador de 6h) acontece dentro de
    // generateAndSendMonthlyPix, junto da persistência do txid/QR — só em caso de sucesso.
    await this.generateAndSendMonthlyPix(tenant);
  }

  async generateAndSendMonthlyPix(tenant: WhatsappConfig): Promise<void> {
    if (!tenant.billingPhone) return;
    // Sem plan_value cadastrado (cliente antigo) → cai no valor histórico fixo.
    const valorNum = Number(tenant.planValue ?? '390.00');
    const valor = valorNum.toFixed(2).replace('.', ',');

    try {
      // txid único por ciclo — a Efí rejeita (409) reuso de um txid já criado antes (pago ou vencido),
      // então nunca reaproveita tenant.id (usado só na 1ª cobrança, no checkout).
      const txid = randomUUID().replace(/-/g, '');
      const pix = await this._efiCreateCob(txid, `Renovação plano Convert Hair`, valorNum.toFixed(2));
      await this._onPixCreated('tenant', tenant.id, txid);
      this.logger.log(`[EFI] QR mensal gerado para tenant ${tenant.id} (txid=${txid})`);
      await this._logBillingEvent(tenant.id, 'pix', 'sent', valorNum, txid);

      // Persiste QR+código+valor já aqui (antes de tentar enviar) — a página pública /pix/:txid
      // depende só do banco, então precisa disso mesmo se o envio por WhatsApp falhar.
      tenant.lastPixSentAt = new Date();
      tenant.lastPixTxid = txid;
      tenant.lastPixQrCode = pix.qrCode;
      tenant.lastPixCode = pix.pixCode;
      tenant.lastPixValue = valorNum.toFixed(2);
      // O status acompanha o PIX recém-gerado, sempre: a página /pix/:txid decide o que
      // mostrar só pelo planStatus, então deixar 'expired' aqui esconde um QR novo e válido
      // (era o que acontecia no reenvio do dia D-1, depois do polling expirar o PIX de D-2).
      if (!['pending', 'past_due'].includes(tenant.planStatus)) tenant.planStatus = 'pending';
      await this.configRepo.save(tenant);

      // WhatsApp e e-mail são canais independentes — falha em um não deve impedir o outro.
      try {
        // pix_mensal_link_v1: sem QR/código no corpo — botão de link leva pra página com os dois
        // prontos pra copiar. Evita o limite de caracteres do botão COPY_CODE (~15, incompatível
        // com o código Pix de 150+) e o texto monoespaçado do v3 (funcional, mas menos amigável).
        const pageUrl = this._buildPixPageUrl(txid);
        await this._sendMetaTemplate(tenant.billingPhone, 'pix_mensal_link_v1', [
          { type: 'body', parameters: [{ type: 'text', text: valor }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: txid }] },
        ]);
        this.logger.log(`[EFI] Link de renovação: ${pageUrl}`);
        await this._logBillingEvent(tenant.id, 'whatsapp', 'sent', valorNum, txid);
      } catch (waErr) {
        this.logger.error(`[EFI] Falha ao enviar PIX mensal por WhatsApp (tenant ${tenant.id}): ${waErr.message}`);
        await this._logBillingEvent(tenant.id, 'whatsapp', 'failed', valorNum, txid, waErr.message);
      }

      const users = await this.usersService.findByTenant(tenant.id);
      const email = users[0]?.email;
      if (email) {
        const result = await this._sendPixEmail(email, tenant.displayName ?? 'Cliente', 'Plano Mensal', valor, pix, 'Renovação mensal do plano Convert Hair.');
        await this._logBillingEvent(tenant.id, 'email', result.ok ? 'sent' : 'failed', valorNum, txid, result.error);
      }

      this.logger.log(`[EFI] PIX mensal enviado → ${tenant.billingPhone} (tenant ${tenant.id})`);
    } catch (err) {
      this.logger.error(`[EFI] Falha ao gerar QR mensal (tenant ${tenant.id}): ${err.message}`);
      await this._logBillingEvent(tenant.id, 'pix', 'failed', valorNum, null, err.message);
    }
  }

  // Admin: histórico de tentativas de cobrança (auditoria/monitoramento de envios no painel)
  async listBillingEvents(tenantId?: string, limit = 100): Promise<any[]> {
    const qb = this.billingEventRepo
      .createQueryBuilder('be')
      .leftJoin(WhatsappConfig, 'wc', 'wc.id = be.tenant_id')
      .select([
        'be.id AS id',
        'be.tenant_id AS "tenantId"',
        // Sem tenant (implantação, paga antes de existir conta) → usa be.label (nome/e-mail do pagador).
        'COALESCE(wc.display_name, wc.profile_name, be.label) AS "tenantName"',
        'be.channel AS channel',
        'be.status AS status',
        'be.amount AS amount',
        'be.txid AS txid',
        'be.error_message AS "errorMessage"',
        'be.created_at AS "createdAt"',
      ])
      .orderBy('be.created_at', 'DESC')
      .limit(limit);
    if (tenantId) qb.where('be.tenant_id = :tenantId', { tenantId });
    return qb.getRawMany();
  }

  private async _logBillingEvent(
    tenantId: string | null,
    channel: 'pix' | 'whatsapp' | 'email' | 'pagamento',
    status: 'sent' | 'failed' | 'confirmado',
    amount: number,
    txid: string | null,
    errorMessage?: string,
    label?: string,
  ): Promise<void> {
    await this.billingEventRepo.save(this.billingEventRepo.create({
      tenantId, channel, status, amount: amount.toFixed(2), txid, errorMessage: errorMessage ?? null, label: label ?? null,
    }));
  }

  // ───────────────────────── Helpers ─────────────────────────

  // A implantação é paga ANTES da conta existir, então não tem FK pro tenant. Quando o
  // pagamento é confirmado (ou quando a conta é criada depois), tenta casar por telefone —
  // comparando só os 8 últimos dígitos, porque os números são gravados em formatos diferentes
  // (com/sem 55, com/sem o 9) dependendo da origem.
  private async _findTenantIdForImplantacao(payment: ImplantacaoPayment): Promise<string | null> {
    const last8 = String(payment.phone ?? '').replace(/\D/g, '').slice(-8);
    if (last8.length < 8) return null;
    const rows = await this.configRepo.query(
      `SELECT id FROM whatsapp_config
       WHERE regexp_replace(COALESCE(billing_phone, ''), '\\D', '', 'g') LIKE '%' || $1
       ORDER BY created_at DESC LIMIT 1`,
      [last8],
    );
    return rows?.[0]?.id ?? null;
  }

  private async _createClientFromPayment(
    name: string,
    email: string,
    phone: string,
    paymentMethod: 'card' | 'pix',
    extra: { stripeCustomerId?: string | null; stripeSubscriptionId?: string | null } & ClientOrigin,
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

    const now = new Date();
    const billingDay = now.getDate();

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
      nextPaymentDate: this._addOneMonth(now),
      stripeCustomerId: extra.stripeCustomerId ?? null,
      stripeSubscriptionId: extra.stripeSubscriptionId ?? null,
      originSource: extra.originSource ?? null,
      originMedium: extra.originMedium ?? null,
      originCampaign: extra.originCampaign ?? null,
    });
    const saved = await this.configRepo.save(tenant);

    // Registra no histórico de cobrança (aba "Cobranças" no Admin) — antes só o PIX
    // era registrado ali (via _activatePaidTenant), pagamento por cartão nunca
    // aparecia na tela mesmo com a assinatura ativa de verdade no Stripe.
    if (paymentMethod === 'card') {
      const settings = await this.getCheckoutSettings();
      await this._logBillingEvent(
        saved.id,
        'pagamento',
        'confirmado',
        Number(settings.planoPrice ?? 397),
        extra.stripeSubscriptionId ?? extra.stripeCustomerId ?? saved.id,
        undefined,
        name,
      );
    }

    const password = this._generatePassword();
    await this.usersService.create({
      email,
      password,
      name,
      tenantId: saved.id,
      role: 'operator',
    });

    this.logger.log(`[PAYMENTS] Conta criada → tenant ${saved.id} (${email}, ${paymentMethod})`);

    await this._sendCredentials(phone || null, email, password, name);

    // Onboarding automático (grupo "Projeto <cliente>" + boas-vindas + link do formulário).
    // Este é o ponto onde os dois eventos de cartão convergem e roda uma vez só por cliente
    // novo (guard de e-mail duplicado no topo). Isolado em try/catch de propósito: falhar em
    // criar grupo não pode impedir a conta/credenciais que já foram entregues.
    try {
      await this.onboarding?.createProjectGroup(saved.id, name, phone || null);
    } catch (err) {
      this.logger.error(`[PAYMENTS] Falha no onboarding automático do tenant ${saved.id}: ${err.message}`);
    }

    if (paymentMethod === 'card') {
      const settings = await this.getCheckoutSettings();
      void this._notifyConvertHairCrmPurchase(phone || null, Number(settings.planoPrice ?? 397), name);
    }
  }

  // Envia as credenciais de acesso pelos dois canais disponíveis: WhatsApp (se houver telefone) e e-mail.
  private async _sendCredentials(phone: string | null, email: string, password: string, name: string): Promise<void> {
    if (phone) await this._sendCredentialsWhatsapp(phone, email, password);
    await this._sendCredentialsEmail(email, name, password);
  }

  private async _sendCredentialsWhatsapp(phone: string, email: string, password: string): Promise<void> {
    const frontendUrl = this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:5173';
    const msg =
      `🎉 Sua conta *Convert Hair* foi criada com sucesso!\n\n` +
      `Acesse: ${frontendUrl}/login\n\n` +
      `📧 E-mail: ${email}\n` +
      `🔑 Senha: ${password}\n\n` +
      `Recomendamos trocar a senha após o primeiro acesso. 🙏`;
    await this._sendText(phone, msg);
  }

  private async _sendCredentialsEmail(email: string, name: string, password: string): Promise<void> {
    if (!this.resend) {
      this.logger.warn('[EMAIL] RESEND_API_KEY não configurada — pulando envio de e-mail de credenciais');
      return;
    }
    const from = this.config.get<string>('RESEND_FROM_EMAIL') ?? 'Convert Hair <onboarding@resend.dev>';
    try {
      await this.resend.emails.send({
        from,
        to: email,
        subject: 'Seu acesso ao Convert Hair 🎉',
        html: this._credentialsEmailHtml(name, email, password),
      });
      this.logger.log(`[EMAIL] Credenciais enviadas para ${email}`);
    } catch (err) {
      this.logger.error(`[EMAIL] Falha ao enviar e-mail de credenciais para ${email}: ${err.message}`);
    }
  }

  // Envia a cobrança PIX (QR + copia-e-cola) por e-mail — canal alternativo ao WhatsApp,
  // usado tanto na implantação quanto no plano mensal. Falha silenciosamente (só loga):
  // o WhatsApp já é o canal principal e não deve ser bloqueado por um problema no Resend.
  private async _sendPixEmail(
    email: string,
    name: string,
    title: string,
    valorTexto: string,
    pix: { qrCode: string; pixCode: string },
    description: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!this.resend) {
      this.logger.warn('[EMAIL] RESEND_API_KEY não configurada — pulando envio de PIX por e-mail');
      return { ok: false, error: 'RESEND_API_KEY não configurada' };
    }
    const from = this.config.get<string>('RESEND_FROM_EMAIL') ?? 'Convert Hair <onboarding@resend.dev>';
    const match = /^data:image\/\w+;base64,(.+)$/.exec(pix.qrCode);
    const qrBuffer = match ? Buffer.from(match[1], 'base64') : null;
    try {
      await this.resend.emails.send({
        from,
        to: email,
        subject: `💳 Seu PIX — ${title} Convert Hair`,
        html: this._pixEmailHtml(name, title, valorTexto, pix.pixCode, description, !!qrBuffer),
        attachments: qrBuffer ? [{ filename: 'qrcode.png', content: qrBuffer, contentType: 'image/png', contentId: 'qrcode' }] : undefined,
      });
      this.logger.log(`[EMAIL] PIX (${title}) enviado para ${email}`);
      return { ok: true };
    } catch (err) {
      this.logger.error(`[EMAIL] Falha ao enviar PIX (${title}) para ${email}: ${err.message}`);
      return { ok: false, error: err.message };
    }
  }

  private _pixEmailHtml(name: string, title: string, valorTexto: string, pixCode: string, description: string, hasQrCode: boolean): string {
    const logoUrl = 'https://app.converthair.com.br/assets/logo_hair-sAAWCMjs.png';

    return `
<!DOCTYPE html>
<html lang="pt-BR">
<body style="margin:0; padding:0; background-color:#f9fafb; font-family: Arial, Helvetica, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f9fafb; padding: 24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0"
          style="background-color:#ffffff; border-radius: 14px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.06);">

          <!-- Logo -->
          <tr>
            <td align="center" style="padding: 28px 24px 8px;">
              <img src="${logoUrl}" alt="Convert Hair" height="40" style="height:40px; object-fit:contain;" />
            </td>
          </tr>

          <!-- Título -->
          <tr>
            <td align="center" style="padding: 8px 32px 4px;">
              <h2 style="margin:0; color:#db2777; font-size:20px;">💳 ${title}</h2>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding: 4px 32px 16px; color:#4b5563; font-size:14px; line-height:1.5;">
              Olá, ${name}! ${description}
            </td>
          </tr>

          <!-- Valor -->
          <tr>
            <td align="center" style="padding-bottom: 16px;">
              <p style="margin:0; color:#9ca3af; font-size:12px;">Valor</p>
              <p style="margin:0; color:#1f2937; font-size:28px; font-weight:bold;">R$ ${valorTexto}</p>
            </td>
          </tr>

          ${hasQrCode ? `
          <!-- QR Code -->
          <tr>
            <td align="center" style="padding-bottom: 16px;">
              <img src="cid:qrcode" alt="QR Code PIX" width="220" height="220" style="width:220px; height:220px; border: 1px solid #f1f1f4; border-radius: 8px;" />
            </td>
          </tr>` : ''}

          <!-- Copia e cola -->
          <tr>
            <td style="padding: 0 32px 8px;">
              <p style="margin:0 0 8px; color:#1f2937; font-weight:bold; font-size:13px;">📋 PIX copia e cola</p>
              <p style="margin:0; padding:12px; background:#f9fafb; border:1px solid #f1f1f4; border-radius:8px; color:#4b5563; font-size:12px; word-break:break-all; font-family: monospace;">${pixCode}</p>
              <p style="margin:8px 0 0; color:#9ca3af; font-size:12px;">Copie o código acima e cole na área "Pix Copia e Cola" do app do seu banco.</p>
            </td>
          </tr>

          <tr><td style="border-top: 1px solid #f1f1f4;"></td></tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding: 20px 32px 28px; color:#9ca3af; font-size:12px; line-height:1.6;">
              Equipe Convert Hair<br/>
              Transformando atendimento em vendas.
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  private _credentialsEmailHtml(name: string, email: string, password: string): string {
    const frontendUrl = this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:5173';
    const loginUrl = `${frontendUrl}/login`;
    const logoUrl = 'https://app.converthair.com.br/assets/logo_hair-sAAWCMjs.png';
    const tutorialUrl = 'https://www.youtube.com/channel/UCf_2s3svRszXEKFJsq5FXAw/';

    const button = (label: string, url: string) => `
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 20px auto;">
        <tr>
          <td style="border-radius: 10px; background: linear-gradient(135deg, #db2777, #7c3aed);">
            <a href="${url}" target="_blank"
              style="display: inline-block; padding: 14px 28px; font-size: 14px; font-weight: bold;
                     color: #ffffff; text-decoration: none; border-radius: 10px;">
              ${label}
            </a>
          </td>
        </tr>
      </table>`;

    return `
<!DOCTYPE html>
<html lang="pt-BR">
<body style="margin:0; padding:0; background-color:#f9fafb; font-family: Arial, Helvetica, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f9fafb; padding: 24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0"
          style="background-color:#ffffff; border-radius: 14px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.06);">

          <!-- Logo -->
          <tr>
            <td align="center" style="padding: 28px 24px 8px;">
              <img src="${logoUrl}" alt="Convert Hair" height="40" style="height:40px; object-fit:contain;" />
            </td>
          </tr>

          <!-- Boas-vindas -->
          <tr>
            <td align="center" style="padding: 8px 32px 4px;">
              <h2 style="margin:0; color:#db2777; font-size:20px;">🎉 Bem-vindo(a) ao Convert Hair!</h2>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding: 4px 32px 8px; color:#4b5563; font-size:14px; line-height:1.5;">
              Sua conta foi criada com sucesso, ${name}.<br/>
              Agora é só fazer seu primeiro acesso.
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-bottom: 8px;">
              ${button('🚀 ACESSAR O PAINEL', loginUrl)}
            </td>
          </tr>

          <tr><td style="border-top: 1px solid #f1f1f4;"></td></tr>

          <!-- Credenciais -->
          <tr>
            <td style="padding: 20px 32px 4px;">
              <p style="margin:0 0 12px; color:#1f2937; font-weight:bold; font-size:14px;">🔐 Seus dados de acesso</p>
              <p style="margin:0 0 4px; color:#6b7280; font-size:13px;">📧 E-mail</p>
              <p style="margin:0 0 12px; color:#1f2937; font-size:14px; font-weight:bold;">${email}</p>
              <p style="margin:0 0 4px; color:#6b7280; font-size:13px;">🔑 Senha provisória</p>
              <p style="margin:0; color:#1f2937; font-size:14px; font-weight:bold;">${password}</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 12px 32px 20px; color:#9ca3af; font-size:12px; line-height:1.5;">
              ℹ️ Por segurança, recomendamos alterar sua senha após o primeiro acesso.
            </td>
          </tr>

          <tr><td style="border-top: 1px solid #f1f1f4;"></td></tr>

          <!-- Próximo passo -->
          <tr>
            <td style="padding: 20px 32px 4px;">
              <p style="margin:0 0 8px; color:#1f2937; font-weight:bold; font-size:14px;">📱 Próximo passo</p>
              <p style="margin:0; color:#4b5563; font-size:13px; line-height:1.5;">
                Conecte seu WhatsApp ao Convert Hair para começar a atender seus clientes e usar
                todas as funcionalidades da plataforma. Você faz isso direto de dentro do painel,
                após o primeiro acesso.
              </p>
            </td>
          </tr>

          <tr><td style="border-top: 1px solid #f1f1f4;"></td></tr>

          <!-- Tutorial -->
          <tr>
            <td style="padding: 20px 32px 4px;">
              <p style="margin:0 0 8px; color:#1f2937; font-weight:bold; font-size:14px;">🎬 Tutorial de configuração</p>
              <p style="margin:0; color:#4b5563; font-size:13px; line-height:1.5;">
                Confira nosso canal com vídeos rápidos mostrando como conectar seu WhatsApp e
                configurar a plataforma em poucos minutos.
              </p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-bottom: 8px;">
              ${button('▶ ASSISTIR TUTORIAIS', tutorialUrl)}
            </td>
          </tr>

          <tr><td style="border-top: 1px solid #f1f1f4;"></td></tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding: 20px 32px 28px; color:#9ca3af; font-size:12px; line-height:1.6;">
              Equipe Convert Hair<br/>
              Transformando atendimento em vendas.
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  // Vencimento de verdade (1 mês a partir de agora), clampado no último dia do mês
  // de destino (ex.: 31/01 -> 28 ou 29/02). Usado no lugar de recalcular "próxima
  // ocorrência do dia X" a partir de billingDay sozinho — essa recalculagem confunde
  // um cliente que ACABOU de assinar hoje com um cliente cujo ciclo vence hoje de
  // verdade, já que nos dois casos billingDay bate com o dia de hoje.
  private _addOneMonth(date: Date): Date {
    const targetMonthIndex = date.getMonth() + 1;
    const year = date.getFullYear() + Math.floor(targetMonthIndex / 12);
    const month = ((targetMonthIndex % 12) + 12) % 12;
    const lastDayOfTargetMonth = new Date(year, month + 1, 0).getDate();
    const day = Math.min(date.getDate(), lastDayOfTargetMonth);
    return new Date(year, month, day, date.getHours(), date.getMinutes(), date.getSeconds());
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

  // Retorna se o envio realmente saiu (não só se a chamada não estourou exceção) —
  // quem dispara um alerta crítico (ex.: falha de pagamento) precisa saber se
  // aconteceu de verdade antes de logar "enviado", em vez de assumir sucesso.
  private async _sendText(phone: string, text: string): Promise<boolean> {
    const baseUrl = this.config.get<string>('UAZAPI_BASE_URL') ?? '';
    const token = await this._resolveSenderToken();
    try {
      await firstValueFrom(this.http.post(`${baseUrl}/send/text`, { number: phone, text }, { headers: { token } }));
      return true;
    } catch (err) {
      this.logger.error(`[PAYMENTS] Falha ao enviar texto para ${phone} [HTTP ${err?.response?.status ?? 'N/A'}]: ${err.message}`);
      return false;
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
      // Registra na tela Financeiro WhatsApp pra manter o histórico da conversa —
      // opcional (specs antigos não injetam esse service, ver constructor).
      this.financeiroWhatsappService
        ?.saveOutbound(to, `[template: ${templateName}]`)
        .catch((err) => this.logger.error(`[FINANCEIRO] Falha ao registrar outbound "${templateName}" para ${to}: ${err.message}`));
    } catch (err) {
      this.logger.error(
        `[PAYMENTS] Falha ao enviar template "${templateName}" para ${to} [HTTP ${err?.response?.status ?? 'N/A'}]: ${JSON.stringify(err?.response?.data ?? err.message)}`,
      );
    }
  }

  async listOverdue(): Promise<WhatsappConfig[]> {
    return this.configRepo.find({ where: { planStatus: 'past_due' } });
  }

  // ───────────────────────── Página pública /pix/:txid ─────────────────────────

  private _buildPixPageUrl(txid: string): string {
    const frontendUrl = this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:5173';
    return `${frontendUrl.replace(/\/$/, '')}/pix/${txid}`;
  }

  // Sem auth (link vem direto do WhatsApp). Só retorna dado de quem tem exatamente esse
  // txid como cobrança ATUAL (lastPixTxid) — um txid de ciclo anterior já não bate mais,
  // então cai em "expired" sem expor nada do ciclo velho.
  async getPixPageData(txid: string): Promise<{
    status: 'pending' | 'paid' | 'expired';
    valor?: string;
    qrCode?: string;
    pixCode?: string;
    clientName?: string;
  }> {
    if (!/^[a-zA-Z0-9]{20,40}$/.test(txid)) return { status: 'expired' };

    const tenant = await this.configRepo.findOne({ where: { lastPixTxid: txid } });
    if (!tenant) return { status: 'expired' };

    if (tenant.planStatus === 'active') return { status: 'paid', clientName: tenant.displayName ?? undefined };
    if (!['pending', 'past_due'].includes(tenant.planStatus)) return { status: 'expired' };
    if (!tenant.lastPixQrCode || !tenant.lastPixCode) return { status: 'expired' };

    // Valor exato usado na geração deste PIX (não recalcula a partir de plan_value: checkout usa
    // outra fonte, e plan_value pode ter mudado/estar nulo entre a geração e a visualização).
    // Fallback pro cálculo antigo só cobre links gerados antes deste campo existir.
    const valorNum = tenant.lastPixValue != null ? Number(tenant.lastPixValue) : Number(tenant.planValue ?? '390.00');
    return {
      status: 'pending',
      valor: valorNum.toFixed(2).replace('.', ','),
      qrCode: tenant.lastPixQrCode,
      pixCode: tenant.lastPixCode,
      clientName: tenant.displayName ?? undefined,
    };
  }
}
