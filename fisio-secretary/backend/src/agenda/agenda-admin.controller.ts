import { BadRequestException, Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { TenantSchedule } from '../common/entities/tenant-schedule.entity';
import { AgendaService } from './agenda.service';

// Liga/desliga a agenda com profissionais por cliente (piloto) — só admin.
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/agenda')
export class AgendaAdminController {
  constructor(
    private readonly agenda: AgendaService,
    @InjectRepository(TenantSchedule) private readonly scheduleRepo: Repository<TenantSchedule>,
  ) {}

  // { [tenantId]: 'professionals' } — só quem está no modo novo.
  @Get('modes')
  async modes() {
    const rows = await this.scheduleRepo.find({ where: { mode: 'professionals' } });
    return Object.fromEntries(rows.map((r) => [r.tenantId, r.mode]));
  }

  @Put(':tenantId/mode')
  async setMode(@Param('tenantId') tenantId: string, @Body() body: { mode?: 'simple' | 'professionals' }) {
    if (body?.mode !== 'simple' && body?.mode !== 'professionals') throw new BadRequestException('mode deve ser simple ou professionals');
    const saved = await this.agenda.updateSettings(tenantId, { mode: body.mode });
    return { tenantId, mode: saved.mode };
  }
}
