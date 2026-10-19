import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Lead } from '../common/entities/lead.entity';
import { AgendaService } from './agenda.service';
import type { ProfessionalDto, ServiceDto } from './agenda.service';
import type { AppointmentStatus } from '../common/entities/appointment.entity';

function parseDate(v: string | undefined, field: string): Date {
  const d = v ? new Date(v) : null;
  if (!d || isNaN(d.getTime())) throw new BadRequestException(`${field} inválido`);
  return d;
}

// Agenda com profissionais e serviços. Tudo filtrado pelo tenant do JWT.
@UseGuards(JwtAuthGuard)
@Controller('agenda')
export class AgendaController {
  constructor(
    private readonly agenda: AgendaService,
    @InjectRepository(Lead) private readonly leadRepo: Repository<Lead>,
  ) {}

  @Get('settings')
  settings(@CurrentUser('tenantId') tenantId: string) {
    return this.agenda.getSettings(tenantId);
  }

  // Trocar o modo (ligar a agenda nova) é só admin — piloto por cliente.
  @Put('settings')
  updateSettings(@Body() body: any, @CurrentUser('tenantId') tenantId: string, @CurrentUser('role') role: string) {
    if (body?.mode !== undefined && role !== 'admin') throw new ForbiddenException('Só o administrador troca o modo da agenda');
    return this.agenda.updateSettings(tenantId, body ?? {});
  }

  @Get('professionals')
  professionals(@CurrentUser('tenantId') tenantId: string) {
    return this.agenda.listProfessionals(tenantId);
  }

  @Post('professionals')
  createProfessional(@Body() dto: ProfessionalDto, @CurrentUser('tenantId') tenantId: string) {
    return this.agenda.createProfessional(tenantId, dto ?? {});
  }

  @Patch('professionals/:id')
  updateProfessional(@Param('id') id: string, @Body() dto: ProfessionalDto, @CurrentUser('tenantId') tenantId: string) {
    return this.agenda.updateProfessional(tenantId, id, dto ?? {});
  }

  @Delete('professionals/:id')
  async deactivateProfessional(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    await this.agenda.deactivateProfessional(tenantId, id);
    return { ok: true };
  }

  @Get('services')
  services(@CurrentUser('tenantId') tenantId: string) {
    return this.agenda.listServices(tenantId);
  }

  @Post('services')
  createService(@Body() dto: ServiceDto, @CurrentUser('tenantId') tenantId: string) {
    return this.agenda.createService(tenantId, dto ?? {});
  }

  @Patch('services/:id')
  updateService(@Param('id') id: string, @Body() dto: ServiceDto, @CurrentUser('tenantId') tenantId: string) {
    return this.agenda.updateService(tenantId, id, dto ?? {});
  }

  @Delete('services/:id')
  async deactivateService(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    await this.agenda.deactivateService(tenantId, id);
    return { ok: true };
  }

  @Get('blocks')
  blocks(@Query('from') from: string, @Query('to') to: string, @CurrentUser('tenantId') tenantId: string) {
    return this.agenda.listBlocks(tenantId, from ? parseDate(from, 'from') : undefined, to ? parseDate(to, 'to') : undefined);
  }

  @Post('blocks')
  createBlock(@Body() body: any, @CurrentUser('tenantId') tenantId: string) {
    return this.agenda.createBlock(tenantId, body ?? {});
  }

  @Delete('blocks/:id')
  async deleteBlock(@Param('id') id: string, @CurrentUser('tenantId') tenantId: string) {
    await this.agenda.deleteBlock(tenantId, id);
    return { ok: true };
  }

  @Get('slots')
  slots(@Query('serviceId') serviceId: string, @Query('from') from: string, @Query('days') days: string, @CurrentUser('tenantId') tenantId: string) {
    if (!serviceId) throw new BadRequestException('serviceId é obrigatório');
    return this.agenda.getSlots(tenantId, serviceId, from || undefined, days ? parseInt(days, 10) : 7);
  }

  @Get('appointments')
  appointments(@Query('from') from: string, @Query('to') to: string, @CurrentUser('tenantId') tenantId: string) {
    return this.agenda.listAppointments(tenantId, parseDate(from, 'from'), parseDate(to, 'to'));
  }

  @Post('appointments')
  book(@Body() body: any, @CurrentUser('tenantId') tenantId: string) {
    return this.agenda.book({
      tenantId,
      serviceId: body?.serviceId,
      start: parseDate(body?.startDateTime, 'startDateTime'),
      professionalId: body?.professionalId || null,
      leadId: body?.leadId || null,
      clientName: body?.clientName,
      clientPhone: body?.clientPhone || null,
      notes: body?.notes || null,
      value: body?.value === '' || body?.value === undefined ? undefined : body?.value === null ? null : Number(body.value),
      source: 'manual',
      force: !!body?.force,
    });
  }

  @Patch('appointments/:id')
  async update(@Param('id') id: string, @Body() body: any, @CurrentUser('tenantId') tenantId: string) {
    let appt: any = null;
    if (body?.startDateTime || body?.professionalId !== undefined || body?.serviceId) {
      appt = await this.agenda.reschedule(tenantId, id, {
        start: body?.startDateTime ? parseDate(body.startDateTime, 'startDateTime') : undefined,
        professionalId: body?.professionalId === undefined ? undefined : body.professionalId || null,
        serviceId: body?.serviceId || undefined,
      }, { force: !!body?.force, source: 'manual' });
    }
    if (body?.status) appt = await this.agenda.setStatus(tenantId, id, body.status as AppointmentStatus);
    if (body?.notes !== undefined || body?.value !== undefined) {
      appt = await this.agenda.updateNotes(tenantId, id, body?.notes ?? null, body?.value === undefined ? undefined : body.value === null || body.value === '' ? null : Number(body.value));
    }
    if (!appt) throw new BadRequestException('Nada para alterar');
    return appt;
  }

  // Busca de cliente pro painel de agendamento (leads do próprio salão, por nome ou telefone).
  @Get('clients')
  async clients(@Query('q') q: string, @CurrentUser('tenantId') tenantId: string) {
    const term = (q ?? '').trim();
    if (term.length < 2) return [];
    const digits = term.replace(/\D/g, '');
    const qb = this.leadRepo.createQueryBuilder('l').select(['l.id', 'l.name', 'l.phone']).where('l.tenant_id = :tenantId', { tenantId });
    if (digits.length >= 4) qb.andWhere('(l.phone LIKE :d OR l.name ILIKE :t)', { d: `%${digits}%`, t: `%${term}%` });
    else qb.andWhere('l.name ILIKE :t', { t: `%${term}%` });
    return qb.orderBy('l.updated_at', 'DESC').limit(10).getMany();
  }
}
