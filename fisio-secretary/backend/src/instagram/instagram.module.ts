import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { InstagramAccount } from '../common/entities/instagram-account.entity';
import { InstagramAutomation } from '../common/entities/instagram-automation.entity';
import { InstagramEvent } from '../common/entities/instagram-event.entity';
import { WhatsappConfig } from '../common/entities/whatsapp-config.entity';
import { AuthModule } from '../auth/auth.module';
import { InstagramClient } from './instagram.client';
import { InstagramService } from './instagram.service';
import { InstagramAdminController, InstagramController, InstagramWebhookController } from './instagram.controller';

// Automação de Instagram (comentário/Direct → WhatsApp). Para ligar em produção:
// IG_FORWARD_SECRET (igual no convertHairCRM) e INTEGRATIONS_ENC_KEY no Railway.
@Module({
  imports: [ConfigModule, HttpModule, TypeOrmModule.forFeature([InstagramAccount, InstagramAutomation, InstagramEvent, WhatsappConfig]), AuthModule],
  providers: [InstagramService, InstagramClient],
  controllers: [InstagramWebhookController, InstagramController, InstagramAdminController],
})
export class InstagramModule {}
