import { Controller, Get, Put, Post, Delete, Param, Body, Query, BadRequestException, UseGuards } from '@nestjs/common';
import { ScheduleService } from './schedule.service';
import type { UpsertScheduleDto, CreateBlockDto } from './schedule.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('schedule')
export class ScheduleController {
  constructor(private readonly scheduleService: ScheduleService) {}

  @Get()
  getSchedule(@CurrentUser('tenantId') tenantId: string) {
    return this.scheduleService.getSchedule(tenantId);
  }

  @Put()
  upsertSchedule(@Body() dto: UpsertScheduleDto, @CurrentUser('tenantId') tenantId: string) {
    return this.scheduleService.upsertSchedule(tenantId, dto);
  }

  @Get('slots')
  getSlots(@Query('days') days: string, @CurrentUser('tenantId') tenantId: string) {
    const d = days ? parseInt(days, 10) : undefined;
    return this.scheduleService.getAvailableSlots(tenantId, { days: d });
  }

  @Get('blocks')
  listBlocks(@CurrentUser('tenantId') tenantId: string) {
    return this.scheduleService.listBlocks(tenantId);
  }

  @Post('blocks')
  createBlock(@Body() dto: CreateBlockDto, @CurrentUser('tenantId') tenantId: string) {
    if (!dto.startDateTime || !dto.endDateTime) throw new BadRequestException('startDateTime e endDateTime são obrigatórios');
    return this.scheduleService.createBlock(tenantId, dto);
  }

  @Delete('blocks/:id')
  async deleteBlock(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    await this.scheduleService.deleteBlock(id, tenantId);
    return { ok: true };
  }
}
