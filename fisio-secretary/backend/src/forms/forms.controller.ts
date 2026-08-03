import { Body, Controller, ForbiddenException, Headers, Logger, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OnboardingForm } from '../common/entities/onboarding-form.entity';
import { WhatsappConfig } from '../common/entities/whatsapp-config.entity';
import { UsersService } from '../auth/users.service';

interface OnboardingFormWebhookDto {
  email?: string;
  respostas: Record<string, string>;
}

// Webhook do Google Form de onboarding (agente de CS, Fase 1 — ver agente-suporte-cs.md).
// Público (sem JwtAuthGuard), protegido por header secreto — mesmo padrão dos webhooks de WhatsApp.
@Controller('forms')
export class FormsController {
  private readonly logger = new Logger(FormsController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly usersService: UsersService,
    @InjectRepository(OnboardingForm)
    private readonly onboardingFormRepo: Repository<OnboardingForm>,
    @InjectRepository(WhatsappConfig)
    private readonly configRepo: Repository<WhatsappConfig>,
  ) {}

  @Post('onboarding-webhook')
  async handleOnboardingWebhook(
    @Headers('x-form-secret') secret: string,
    @Body() body: OnboardingFormWebhookDto,
  ) {
    const expected = this.config.get<string>('FORM_WEBHOOK_SECRET');
    if (!expected || secret !== expected) {
      throw new ForbiddenException('Token inválido');
    }

    const email = body.email?.trim().toLowerCase() || null;
    const user = email ? await this.usersService.findByEmail(email) : null;
    const tenantId = user?.tenantId ?? null;

    await this.onboardingFormRepo.save(
      this.onboardingFormRepo.create({ tenantId, email, answers: body.respostas ?? {} }),
    );

    if (tenantId) {
      await this.configRepo.update(tenantId, { promptFormSubmittedAt: new Date() });
      this.logger.log(`[FORMS] Onboarding recebido de ${email} → tenant ${tenantId}`);
    } else {
      this.logger.warn(`[FORMS] Onboarding recebido de ${email ?? '(sem email)'} — tenant não encontrado (órfão, respostas salvas)`);
    }

    return { received: true };
  }
}
