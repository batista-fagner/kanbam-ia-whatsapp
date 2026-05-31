import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { ScheduleModule } from '@nestjs/schedule';
import { WhatsappConfig } from '../common/entities/whatsapp-config.entity';
import { BillingReminderService } from './billing-reminder.service';
import { BillingController } from './billing.controller';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    TypeOrmModule.forFeature([WhatsappConfig]),
    HttpModule,
  ],
  providers: [BillingReminderService],
  controllers: [BillingController],
})
export class BillingModule {}
