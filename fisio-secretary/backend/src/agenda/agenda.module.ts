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
import { SalonAlertNotifier } from './agenda-notifier';
import { AgendaIntegration } from '../common/entities/agenda-integration.entity';
import { TrinksIntegrationService } from './trinks/trinks-integration.service';
import { TrinksAgendaBackend } from './trinks/trinks-agenda.backend';
import { TrinksAiFlow } from './trinks/trinks-ai.flow';
import { TrinksAdminController, TrinksController } from './trinks/trinks.controller';

// Agenda com profissionais e serviços (tenant_schedules.mode='professionals') e agenda da
// Trinks (mode='trinks', pasta trinks/).
@Module({
  imports: [
    TypeOrmModule.forFeature([AgendaProfessional, AgendaServiceEntity, AgendaProfessionalService, Appointment, ScheduleBlock, TenantSchedule, WhatsappConfig, Lead, AgendaIntegration]),
    TenantScheduleModule,
  ],
  providers: [AgendaService, AgendaNotifier, SalonAlertNotifier, TrinksIntegrationService, TrinksAgendaBackend, TrinksAiFlow, AgendaAiService],
  controllers: [AgendaController, AgendaAdminController, TrinksController, TrinksAdminController],
  exports: [AgendaService, AgendaAiService],
})
export class AgendaModule {}
