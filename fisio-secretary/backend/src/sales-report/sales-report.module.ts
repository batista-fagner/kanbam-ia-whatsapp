import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { SalesReport } from '../common/entities/sales-report.entity';
import { WhatsappConfig } from '../common/entities/whatsapp-config.entity';
import { LeadsModule } from '../leads/leads.module';
import { AuthModule } from '../auth/auth.module';
import { SalesReportService } from './sales-report.service';
import { SalesReportPdfService } from './sales-report-pdf.service';
import { SalesReportController, SalesReportMonitoringController } from './sales-report.controller';

@Module({
  imports: [ConfigModule, HttpModule, TypeOrmModule.forFeature([SalesReport, WhatsappConfig]), LeadsModule, AuthModule],
  providers: [SalesReportService, SalesReportPdfService],
  controllers: [SalesReportController, SalesReportMonitoringController],
})
export class SalesReportModule {}
