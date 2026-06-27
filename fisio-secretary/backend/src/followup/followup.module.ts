import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { ScheduleModule } from '@nestjs/schedule';
import { Followup } from '../common/entities/followup.entity';
import { WhatsappConfig } from '../common/entities/whatsapp-config.entity';
import { FollowupService } from './followup.service';
import { FollowupController } from './followup.controller';
import { LeadsModule } from '../leads/leads.module';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { AppointmentsModule } from '../appointments/appointments.module';

@Module({
  imports: [
    ConfigModule,
    ScheduleModule.forRoot(),
    HttpModule,
    TypeOrmModule.forFeature([Followup, WhatsappConfig]),
    LeadsModule,
    AiModule,
    AuthModule,
    AppointmentsModule,
  ],
  providers: [FollowupService],
  controllers: [FollowupController],
})
export class FollowupModule {}
