import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { FinanceiroWhatsappService } from './financeiro-whatsapp.service';

// Só admin da plataforma — o número financeiro (0415) não é por-tenant, é o
// número da própria Convert Hair falando com os clientes do SaaS.
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('financeiro-whatsapp')
export class FinanceiroWhatsappController {
  constructor(private readonly service: FinanceiroWhatsappService) {}

  @Get('conversations')
  async listConversations() {
    return this.service.listConversations();
  }

  @Get('messages/:phone')
  async listMessages(@Param('phone') phone: string) {
    return this.service.listMessages(phone);
  }
}
