import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { WhatsappConfig } from '../common/entities/whatsapp-config.entity';
import { ImplantacaoPayment } from '../common/entities/implantacao-payment.entity';
import { CheckoutSettings } from '../common/entities/checkout-settings.entity';
import { BillingEvent } from '../common/entities/billing-event.entity';
import { BullModule } from '@nestjs/bullmq';
import { AuthModule } from '../auth/auth.module';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { PixQueueService } from './pix-queue.service';
import { PixPollProcessor } from './pix-poll.processor';
import { PIX_QUEUE_NAME } from '../queue/queue.constants';
import { queueEngineEnabled } from '../queue/queue.enabled';
import { FinanceiroWhatsappModule } from '../financeiro-whatsapp/financeiro-whatsapp.module';
import { OnboardingModule } from '../onboarding/onboarding.module';

// Fila e worker só existem no modo bullmq — no legado não há conexão Redis registrada,
// e declarar a fila aqui faria o boot falhar por dependência ausente.
const queueParts = queueEngineEnabled ? [BullModule.registerQueue({ name: PIX_QUEUE_NAME })] : [];
const queueProviders = queueEngineEnabled ? [PixPollProcessor] : [];

@Module({
  imports: [
    ConfigModule,
    HttpModule,
    // A conexão Redis vem do QueueModule (@Global); aqui só declaramos a fila.
    ...queueParts,
    TypeOrmModule.forFeature([WhatsappConfig, ImplantacaoPayment, CheckoutSettings, BillingEvent]),
    AuthModule, // exporta UsersService + JwtModule (guards)
    FinanceiroWhatsappModule,
    OnboardingModule, // grupo automático + boas-vindas após pagamento confirmado
  ],
  providers: [PaymentsService, PixQueueService, ...queueProviders],
  controllers: [PaymentsController],
  exports: [PaymentsService],
})
export class PaymentsModule {}
