import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { WhatsappConfig } from '../common/entities/whatsapp-config.entity';
import { OnboardingSettings } from '../common/entities/onboarding-settings.entity';
import { AuthModule } from '../auth/auth.module';
import { OnboardingService } from './onboarding.service';
import { OnboardingController } from './onboarding.controller';
import { OnboardingQueueService } from './onboarding-queue.service';
import { OnboardingFormProcessor } from './onboarding-form.processor';
import { ONBOARDING_QUEUE_NAME } from '../queue/queue.constants';
import { queueEngineEnabled } from '../queue/queue.enabled';

// Fila e worker só existem no modo bullmq — no legado não há conexão Redis registrada,
// e declarar a fila aqui faria o boot falhar por dependência ausente.
const queueParts = queueEngineEnabled ? [BullModule.registerQueue({ name: ONBOARDING_QUEUE_NAME })] : [];
const queueProviders = queueEngineEnabled ? [OnboardingFormProcessor] : [];

@Module({
  imports: [
    ConfigModule,
    HttpModule,
    ...queueParts,
    TypeOrmModule.forFeature([WhatsappConfig, OnboardingSettings]),
    AuthModule, // guards (JwtAuthGuard + AdminGuard)
  ],
  providers: [OnboardingService, OnboardingQueueService, ...queueProviders],
  controllers: [OnboardingController],
  exports: [OnboardingService],
})
export class OnboardingModule {}
