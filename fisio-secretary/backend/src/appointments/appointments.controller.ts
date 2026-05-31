import { Controller, Get, Post, Patch, Delete, Param, Body, Query, BadRequestException, UseGuards } from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import type { CreateAppointmentDto, UpdateAppointmentDto } from './appointments.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Get()
  async findByMonth(@Query('year') year: string, @Query('month') month: string, @CurrentUser('tenantId') tenantId: string) {
    const y = parseInt(year, 10);
    const m = parseInt(month, 10);
    if (!y || !m || m < 1 || m > 12) {
      throw new BadRequestException('year e month são obrigatórios (month entre 1 e 12)');
    }
    return this.appointmentsService.findByMonth(y, m, tenantId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    return this.appointmentsService.findOne(id, tenantId);
  }

  @Post()
  create(@Body() dto: CreateAppointmentDto, @CurrentUser('tenantId') tenantId: string) {
    if (!dto.clientName || !dto.startDateTime || !dto.service) {
      throw new BadRequestException('clientName, startDateTime e service são obrigatórios');
    }
    return this.appointmentsService.create({ ...dto, tenantId });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAppointmentDto, @CurrentUser('tenantId') tenantId: string) {
    return this.appointmentsService.update(id, dto, tenantId);
  }

  @Delete(':id')
  async delete(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    await this.appointmentsService.delete(id, tenantId);
    return { ok: true };
  }
}
