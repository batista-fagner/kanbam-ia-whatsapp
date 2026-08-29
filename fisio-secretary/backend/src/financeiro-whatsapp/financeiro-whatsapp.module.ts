import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FinanceiroWhatsappMessage } from '../common/entities/financeiro-whatsapp-message.entity';
import { WhatsappConfig } from '../common/entities/whatsapp-config.entity';
import { FinanceiroWhatsappService } from './financeiro-whatsapp.service';
import { FinanceiroWhatsappController } from './financeiro-whatsapp.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([FinanceiroWhatsappMessage, WhatsappConfig]), AuthModule],
  controllers: [FinanceiroWhatsappController],
  providers: [FinanceiroWhatsappService],
  exports: [FinanceiroWhatsappService],
})
export class FinanceiroWhatsappModule {}
