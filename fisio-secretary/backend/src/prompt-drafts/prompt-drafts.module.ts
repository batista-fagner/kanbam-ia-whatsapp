import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GeneratedPrompt } from '../common/entities/generated-prompt.entity';
import { OnboardingForm } from '../common/entities/onboarding-form.entity';
import { WhatsappConfig } from '../common/entities/whatsapp-config.entity';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { PromptDraftsService } from './prompt-drafts.service';
import { PromptDraftsController } from './prompt-drafts.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([GeneratedPrompt, OnboardingForm, WhatsappConfig]),
    AiModule,
    AuthModule,
  ],
  controllers: [PromptDraftsController],
  providers: [PromptDraftsService],
})
export class PromptDraftsModule {}
