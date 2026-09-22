import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantSchedule } from '../common/entities/tenant-schedule.entity';
import { ScheduleBlock } from '../common/entities/schedule-block.entity';
import { Appointment } from '../common/entities/appointment.entity';
import { ScheduleService } from './schedule.service';
import { ScheduleController } from './schedule.controller';

// Nome "TenantSchedule..." (não "Schedule...") pra não colidir com o ScheduleModule do
// @nestjs/schedule (@Cron), já importado/registrado uma única vez em app.module.ts.
@Module({
  imports: [TypeOrmModule.forFeature([TenantSchedule, ScheduleBlock, Appointment])],
  providers: [ScheduleService],
  controllers: [ScheduleController],
  exports: [ScheduleService],
})
export class TenantScheduleModule {}
