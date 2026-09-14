import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { WhatsappConfig } from '../common/entities/whatsapp-config.entity';
import { OnboardingSettings } from '../common/entities/onboarding-settings.entity';
import { GroupMessage } from '../common/entities/group-message.entity';
import { GroupDailyReport } from '../common/entities/group-daily-report.entity';
import { GroupMonitorSettings } from '../common/entities/group-monitor-settings.entity';
import { AuthModule } from '../auth/auth.module';
import { AiModule } from '../ai/ai.module';
import { UazapiProvider } from '../evolution/providers/uazapi.provider';
import { GroupMonitorService } from './group-monitor.service';
import { GroupMonitorReportService } from './group-monitor-report.service';
import { GroupMonitorController } from './group-monitor.controller';

// UazapiProvider é declarado aqui como provider local (em vez de importar EvolutionModule)
// pra evitar ciclo: EvolutionModule precisa importar GroupMonitorModule (o
// EvolutionController injeta GroupMonitorService pro webhook novo), então este módulo não
// pode depender de volta do EvolutionModule.
@Module({
  imports: [
    ConfigModule,
    HttpModule,
    TypeOrmModule.forFeature([WhatsappConfig, OnboardingSettings, GroupMessage, GroupDailyReport, GroupMonitorSettings]),
    AuthModule, // guards (JwtAuthGuard + AdminGuard)
    AiModule,
  ],
  providers: [GroupMonitorService, GroupMonitorReportService, UazapiProvider],
  controllers: [GroupMonitorController],
  exports: [GroupMonitorService],
})
export class GroupMonitorModule {}
