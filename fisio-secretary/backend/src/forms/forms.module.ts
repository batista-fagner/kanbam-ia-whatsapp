import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OnboardingForm } from '../common/entities/onboarding-form.entity';
import { ClientForm } from '../common/entities/client-form.entity';
import { WhatsappConfig } from '../common/entities/whatsapp-config.entity';
import { FormsController } from './forms.controller';
import { AdminClientFormsController, PublicClientFormsController } from './client-forms.controller';
import { ClientFormsService } from './client-forms.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([OnboardingForm, ClientForm, WhatsappConfig]), AuthModule],
  controllers: [FormsController, AdminClientFormsController, PublicClientFormsController],
  providers: [ClientFormsService],
})
export class FormsModule {}
