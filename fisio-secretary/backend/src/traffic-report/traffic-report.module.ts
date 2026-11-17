import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { TrafficReportClient } from '../common/entities/traffic-report-client.entity';
import { TrafficReport } from '../common/entities/traffic-report.entity';
import { AuthModule } from '../auth/auth.module';
import { MetaAdsClient } from './meta-ads.client';
import { TrafficReportService } from './traffic-report.service';
import { TrafficReportAdminController, TrafficReportApprovalController } from './traffic-report.controller';

// Relatório semanal de tráfego pago (clientes da consultoria). Independe do CRM/tenants.
// Para ligar em produção: META_ADS_TOKEN no Railway (ver meta-ads.client.ts).
@Module({
  imports: [ConfigModule, HttpModule, TypeOrmModule.forFeature([TrafficReportClient, TrafficReport]), AuthModule],
  providers: [TrafficReportService, MetaAdsClient],
  controllers: [TrafficReportApprovalController, TrafficReportAdminController],
})
export class TrafficReportModule {}
