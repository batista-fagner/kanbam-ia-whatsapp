import { Controller, Post, Get, Body, Req, Headers, UseGuards, BadRequestException } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { PaymentsService } from './payments.service';

@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  // Público: inicia o checkout (cartão recorrente via Stripe; PIX via Efí Bank — em breve)
  @Post('payments/checkout')
  async checkout(@Body() body: { name: string; email: string; phone: string; method: 'card' | 'pix' }) {
    if (!body?.name?.trim()) throw new BadRequestException('Nome é obrigatório');
    if (!body?.email?.trim()) throw new BadRequestException('E-mail é obrigatório');
    if (!body?.phone?.trim()) throw new BadRequestException('WhatsApp é obrigatório');

    const name = body.name.trim();
    const email = body.email.trim().toLowerCase();
    const phone = body.phone.replace(/\D/g, '');

    if (body.method === 'pix') {
      throw new BadRequestException('Pagamento via PIX em breve. Use cartão por enquanto.');
    }

    return this.payments.createCardCheckout(name, email, phone);
  }

  // Público: recebe eventos do Stripe (assinatura verificada via raw body)
  @Post('webhooks/stripe')
  async stripeWebhook(@Req() req: Request & { rawBody?: Buffer }, @Headers('stripe-signature') signature: string) {
    if (!req.rawBody) throw new BadRequestException('rawBody ausente');
    return this.payments.handleWebhook(req.rawBody, signature);
  }

  // Admin: lista clientes com PIX em atraso (alerta no painel)
  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('payments/overdue')
  async overdue() {
    return this.payments.listOverdue();
  }

  // Público: recebe confirmações de pagamento da Efí Bank
  @Post('webhooks/efi')
  async efiWebhook(@Body() body: any) {
    return this.payments.handleEfiWebhook(body);
  }
}
