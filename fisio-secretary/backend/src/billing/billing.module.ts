import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { ScheduleModule } from '@nestjs/schedule';
import { WhatsappConfig } from '../common/entities/whatsapp-config.entity';
import { BillingReminderService } from './billing-reminder.service';
import { BillingController } from './billing.controller';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    TypeOrmModule.forFeature([WhatsappConfig]),
    HttpModule,
    PaymentsModule,
  ],
  providers: [BillingReminderService],
  controllers: [BillingController],
})
export class BillingModule {}
