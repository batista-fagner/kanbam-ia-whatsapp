import { Controller, Post, Get, Body, Param, Query, Req, Headers, UseGuards, BadRequestException } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { PaymentsService } from './payments.service';

// UTM lidos da URL do checkout (CheckoutPage.jsx readOrigin) — opcionais.
type OriginFields = {
  originSource?: string | null;
  originMedium?: string | null;
  originCampaign?: string | null;
};

type ImplantacaoBody = { name: string; phone: string; email: string } & OriginFields;
type CheckoutBody = { name: string; email: string; phone: string; method: 'card' | 'pix' } & OriginFields;

@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  // Público: taxa de implantação (R$400 único, apenas PIX, sem criar conta)
  @Post('payments/implantacao')
  async implantacao(@Body() body: ImplantacaoBody) {
    if (!body?.name?.trim()) throw new BadRequestException('Nome é obrigatório');
    if (!body?.phone?.trim()) throw new BadRequestException('WhatsApp é obrigatório');
    if (!body?.email?.trim()) throw new BadRequestException('E-mail é obrigatório');
    const name = body.name.trim();
    const phone = body.phone.replace(/\D/g, '');
    const email = body.email.trim().toLowerCase();
    return this.payments.createImplantacaoCheckout(name, phone, email);
  }

  // Público: inicia o checkout (cartão recorrente via Stripe; PIX via Efí Bank enviado no WhatsApp)
  @Post('payments/checkout')
  async checkout(@Body() body: CheckoutBody) {
    if (!body?.name?.trim()) throw new BadRequestException('Nome é obrigatório');
    if (!body?.email?.trim()) throw new BadRequestException('E-mail é obrigatório');
    if (!body?.phone?.trim()) throw new BadRequestException('WhatsApp é obrigatório');

    const name = body.name.trim();
    const email = body.email.trim().toLowerCase();
    const phone = body.phone.replace(/\D/g, '');

    // UTM da URL do checkout, quando o link vem taggeado. Sem isso a origem fica null e é
    // preenchida depois pelo sync com o convertHairCRM (tela Financeiro do Admin).
    const origin = {
      originSource: body.originSource?.trim() || null,
      originMedium: body.originMedium?.trim() || null,
      originCampaign: body.originCampaign?.trim() || null,
    };

    if (body.method === 'pix') {
      return this.payments.createPixCheckout(name, email, phone, origin);
    }

    return this.payments.createCardCheckout(name, email, phone, origin);
  }

  // Público: recebe eventos do Stripe (assinatura verificada via raw body)
  // Duas rotas para compatibilidade — /webhooks/stripe (correto) e /payments/webhooks/stripe (legado)
  @Post('webhooks/stripe')
  async stripeWebhook(@Req() req: Request & { rawBody?: Buffer }, @Headers('stripe-signature') signature: string) {
    if (!req.rawBody) throw new BadRequestException('rawBody ausente');
    return this.payments.handleWebhook(req.rawBody, signature);
  }

  @Post('payments/webhooks/stripe')
  async stripeWebhookAlias(@Req() req: Request & { rawBody?: Buffer }, @Headers('stripe-signature') signature: string) {
    if (!req.rawBody) throw new BadRequestException('rawBody ausente');
    return this.payments.handleWebhook(req.rawBody, signature);
  }

  // Admin: lista clientes com PIX em atraso (alerta no painel)
  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('payments/overdue')
  async overdue() {
    return this.payments.listOverdue();
  }

  // Admin: reenvia o PIX mensal na hora (útil quando a janela automática de 2 dias já passou)
  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('admin/clients/:id/resend-monthly-pix')
  async resendMonthlyPix(@Param('id') id: string) {
    await this.payments.resendMonthlyPix(id);
    return { ok: true };
  }

  // Admin: histórico de tentativas de cobrança PIX (auditoria/monitoramento de envios)
  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('admin/billing-events')
  async billingEvents(@Query('tenantId') tenantId?: string, @Query('limit') limit?: string) {
    return this.payments.listBillingEvents(tenantId, limit ? parseInt(limit, 10) : 100);
  }

  // Público: o que exibir no checkout (métodos habilitados + valores) — sem dado sensível.
  @Get('payments/checkout-settings')
  async checkoutSettingsPublic() {
    const s = await this.payments.getCheckoutSettings();
    return {
      pixEnabled: s.pixEnabled,
      cardEnabled: s.cardEnabled,
      implantacaoEnabled: s.implantacaoEnabled,
      planoEnabled: s.planoEnabled,
      implantacaoPrice: Number(s.implantacaoPrice),
      planoPrice: Number(s.planoPrice),
    };
  }

  // Admin: configurações completas do checkout (edição)
  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('admin/checkout-settings')
  async checkoutSettingsAdmin() {
    return this.payments.getCheckoutSettings();
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('admin/checkout-settings')
  async updateCheckoutSettings(@Body() body: {
    pixEnabled?: boolean;
    cardEnabled?: boolean;
    implantacaoEnabled?: boolean;
    planoEnabled?: boolean;
    implantacaoPrice?: number;
    planoPrice?: number;
  }) {
    return this.payments.updateCheckoutSettings(body);
  }

  // Público: dados da página de renovação (QR + código Pix) — link enviado no template do WhatsApp.
  @Get('payments/pix/:txid')
  async pixPage(@Param('txid') txid: string) {
    return this.payments.getPixPageData(txid);
  }

  // Público: recebe confirmações de pagamento da Efí Bank (fallback — exige mTLS).
  // A confirmação principal é por polling (PaymentsService.pollPendingPix).
  @Post('webhooks/efi')
  async efiWebhook(@Body() body: any) {
    return this.payments.handleEfiWebhook(body);
  }
}
