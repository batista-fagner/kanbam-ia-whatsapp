import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgendaProfessional } from '../common/entities/agenda-professional.entity';
import { AgendaServiceEntity } from '../common/entities/agenda-service.entity';
import { AgendaProfessionalService } from '../common/entities/agenda-professional-service.entity';
import { Appointment } from '../common/entities/appointment.entity';
import { ScheduleBlock } from '../common/entities/schedule-block.entity';
import { TenantSchedule } from '../common/entities/tenant-schedule.entity';
import { WhatsappConfig } from '../common/entities/whatsapp-config.entity';
import { Lead } from '../common/entities/lead.entity';
import { TenantScheduleModule } from '../schedule/schedule.module';
import { AgendaService } from './agenda.service';
import { AgendaNotifier } from './agenda-notifier';
import { AgendaController } from './agenda.controller';
import { AgendaAdminController } from './agenda-admin.controller';
import { AgendaAiService } from './agenda-ai.service';

// Agenda com profissionais e serviços (tenant_schedules.mode='professionals').
@Module({
  imports: [
    TypeOrmModule.forFeature([AgendaProfessional, AgendaServiceEntity, AgendaProfessionalService, Appointment, ScheduleBlock, TenantSchedule, WhatsappConfig, Lead]),
    TenantScheduleModule,
  ],
  providers: [AgendaService, AgendaNotifier, AgendaAiService],
  controllers: [AgendaController, AgendaAdminController],
  exports: [AgendaService, AgendaAiService],
})
export class AgendaModule {}
