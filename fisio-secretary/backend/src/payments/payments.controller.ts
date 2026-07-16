import { Controller, Post, Get, Body, Req, Headers, UseGuards, BadRequestException } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { PaymentsService } from './payments.service';

@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  // Público: taxa de implantação (R$400 único, apenas PIX, sem criar conta)
  @Post('payments/implantacao')
  async implantacao(@Body() body: { name: string; phone: string }) {
    if (!body?.name?.trim()) throw new BadRequestException('Nome é obrigatório');
    if (!body?.phone?.trim()) throw new BadRequestException('WhatsApp é obrigatório');
    const name = body.name.trim();
    const phone = body.phone.replace(/\D/g, '');
    return this.payments.createImplantacaoCheckout(name, phone);
  }

  // Público: inicia o checkout (cartão recorrente via Stripe; PIX via Efí Bank enviado no WhatsApp)
  @Post('payments/checkout')
  async checkout(@Body() body: { name: string; email: string; phone: string; method: 'card' | 'pix' }) {
    if (!body?.name?.trim()) throw new BadRequestException('Nome é obrigatório');
    if (!body?.email?.trim()) throw new BadRequestException('E-mail é obrigatório');
    if (!body?.phone?.trim()) throw new BadRequestException('WhatsApp é obrigatório');

    const name = body.name.trim();
    const email = body.email.trim().toLowerCase();
    const phone = body.phone.replace(/\D/g, '');

    if (body.method === 'pix') {
      return this.payments.createPixCheckout(name, email, phone);
    }

    return this.payments.createCardCheckout(name, email, phone);
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

  // Público: recebe confirmações de pagamento da Efí Bank (fallback — exige mTLS).
  // A confirmação principal é por polling (PaymentsService.pollPendingPix).
  @Post('webhooks/efi')
  async efiWebhook(@Body() body: any) {
    return this.payments.handleEfiWebhook(body);
  }
}
