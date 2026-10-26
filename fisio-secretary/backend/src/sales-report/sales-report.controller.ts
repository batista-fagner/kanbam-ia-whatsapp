import { Controller, ForbiddenException, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/jwt.strategy';
import { SalesReportService } from './sales-report.service';

@UseGuards(JwtAuthGuard)
@Controller('sales-reports')
export class SalesReportController {
  constructor(private readonly reports: SalesReportService) {}

  private tenant(user: AuthUser): string {
    if (!user?.tenantId) throw new ForbiddenException('Conta sem cliente vinculado');
    return user.tenantId;
  }

  @Get('status')
  status(@CurrentUser() user: AuthUser) {
    return this.reports.status(this.tenant(user), user.role === 'admin');
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.reports.list(this.tenant(user));
  }

  @Post()
  async create(@CurrentUser() user: AuthUser) {
    const r = await this.reports.request(this.tenant(user), user.userId ?? null, user.role === 'admin');
    return { id: r.id, status: r.status };
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.reports.get(id, this.tenant(user));
  }

  @Get(':id/pdf')
  async pdf(@Param('id') id: string, @CurrentUser() user: AuthUser, @Res() res: Response) {
    const { buffer, fileName } = await this.reports.buildPdf(id, this.tenant(user));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  }
}

// Monitoramento (admin): cada relatório gerado com a estimativa de custo.
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/monitoring')
export class SalesReportMonitoringController {
  constructor(private readonly reports: SalesReportService) {}

  @Get('sales-reports')
  list(@Query('from') from?: string, @Query('to') to?: string) {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    return this.reports.listForMonitoring(from ?? today, to ?? today);
  }
}
