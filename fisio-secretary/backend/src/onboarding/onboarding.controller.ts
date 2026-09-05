import { Controller, Get, Put, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { OnboardingService } from './onboarding.service';

// Configuração global do onboarding (aba "Onboarding" no Admin) — só o dono da plataforma.
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get('settings')
  async getSettings() {
    return this.onboarding.getSettings();
  }

  @Put('settings')
  async updateSettings(
    @Body()
    body: {
      groupEnabled?: boolean;
      teamPhones?: string[];
      welcomeMessage?: string;
      formMessageEnabled?: boolean;
      formMessage?: string;
      formDelayMinutes?: number;
      formUrl?: string;
      formEntryField?: string;
    },
  ) {
    return this.onboarding.updateSettings(body);
  }

  // Cria um grupo só com a equipe (sem cliente) — valida instância/credencial/formato sem
  // envolver cliente real.
  @Post('test-group')
  async testGroup() {
    return this.onboarding.createTestGroup();
  }
}
