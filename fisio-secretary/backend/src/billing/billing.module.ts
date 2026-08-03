import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { WhatsappConfig } from '../common/entities/whatsapp-config.entity';
import { BillingReminderService } from './billing-reminder.service';
import { BillingController } from './billing.controller';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [
    // ScheduleModule.forRoot() já é registrado uma única vez no AppModule —
    // NÃO repetir aqui (duplicava a execução de todo @Cron() do sistema).
    TypeOrmModule.forFeature([WhatsappConfig]),
    HttpModule,
    PaymentsModule,
  ],
  providers: [BillingReminderService],
  controllers: [BillingController],
})
export class BillingModule {}
