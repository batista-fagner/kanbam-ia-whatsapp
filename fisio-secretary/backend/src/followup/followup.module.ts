import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { Followup } from '../common/entities/followup.entity';
import { WhatsappConfig } from '../common/entities/whatsapp-config.entity';
import { Agent } from '../common/entities/agent.entity';
import { BullModule } from '@nestjs/bullmq';
import { FollowupService } from './followup.service';
import { FollowupController } from './followup.controller';
import { FollowupQueueService } from './followup-queue.service';
import { FollowupDispatchProcessor } from './followup-dispatch.processor';
import { FOLLOWUP_QUEUE_NAME } from '../queue/queue.constants';
import { queueEngineEnabled } from '../queue/queue.enabled';

// Idem payments.module.ts: sem o modo bullmq não há conexão Redis registrada.
const queueParts = queueEngineEnabled ? [BullModule.registerQueue({ name: FOLLOWUP_QUEUE_NAME })] : [];
const queueProviders = queueEngineEnabled ? [FollowupDispatchProcessor] : [];
import { LeadsModule } from '../leads/leads.module';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { AppointmentsModule } from '../appointments/appointments.module';

@Module({
  imports: [
    ConfigModule,
    // ScheduleModule.forRoot() já é registrado uma única vez no AppModule —
    // NÃO repetir aqui (duplicava a execução de todo @Cron() do sistema).
    HttpModule,
    // Conexão Redis vem do QueueModule (@Global); aqui só a fila deste domínio.
    ...queueParts,
    TypeOrmModule.forFeature([Followup, WhatsappConfig, Agent]),
    LeadsModule,
    AiModule,
    AuthModule,
    AppointmentsModule,
  ],
  providers: [FollowupService, FollowupQueueService, ...queueProviders],
  controllers: [FollowupController],
  exports: [FollowupService],
})
export class FollowupModule {}
