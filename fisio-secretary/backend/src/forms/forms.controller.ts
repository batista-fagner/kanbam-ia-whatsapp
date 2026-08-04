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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Título da pergunta oculta no Forms — carrega o tenantId via link pré-preenchido
// (Forms → ⋮ → "Preencher formulário automaticamente"). O cliente vê o campo mas não
// precisa alterá-lo; é opcional pra não travar o envio se ele mexer nele por engano.
// Comparação por trim+lowercase (não exata): o título real no Forms às vezes chega
// com espaço extra (ex.: " Código interno") por edição manual da pergunta.
const TENANT_FIELD_TITLE = 'código interno';

function findByNormalizedTitle(respostas: Record<string, string>, title: string): string | undefined {
  for (const key of Object.keys(respostas)) {
    if (key.trim().toLowerCase() === title) return respostas[key];
  }
  return undefined;
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

    const respostas = body.respostas ?? {};
    const email = body.email?.trim().toLowerCase() || null;

    // Fonte principal: campo oculto "Código interno", preenchido via link pré-preenchido
    // (não depende de qual conta Google o cliente usou pra responder).
    let tenantId: string | null = null;
    const codigoInterno = findByNormalizedTitle(respostas, TENANT_FIELD_TITLE)?.trim();
    if (codigoInterno && UUID_RE.test(codigoInterno)) {
      const tenant = await this.configRepo.findOne({ where: { id: codigoInterno } });
      if (tenant) tenantId = tenant.id;
    }

    // Fallback (form antigo/link genérico, sem o campo oculto): tenta pelo e-mail do respondente.
    if (!tenantId && email) {
      const user = await this.usersService.findByEmail(email);
      tenantId = user?.tenantId ?? null;
    }

    await this.onboardingFormRepo.save(
      this.onboardingFormRepo.create({ tenantId, email, answers: respostas }),
    );

    if (tenantId) {
      await this.configRepo.update(tenantId, { promptFormSubmittedAt: new Date() });
      this.logger.log(`[FORMS] Onboarding recebido (${email ?? 'sem email'}) → tenant ${tenantId}`);
    } else {
      this.logger.warn(`[FORMS] Onboarding recebido de ${email ?? '(sem email)'} — tenant não encontrado (órfão, respostas salvas)`);
    }

    return { received: true };
  }
}
