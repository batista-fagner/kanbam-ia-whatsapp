import { BadRequestException, Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/jwt.strategy';
import { PriceConfigService } from './price-config.service';
import type { PriceConfigDto } from './price-config.service';

// Sempre o tenant do JWT — o cliente só lê/edita a própria tabela.
@UseGuards(JwtAuthGuard)
@Controller('price-config')
export class PriceConfigController {
  constructor(private readonly service: PriceConfigService) {}

  @Get()
  get(@CurrentUser('tenantId') tenantId: string) {
    return this.service.get(tenantId);
  }

  @Put()
  save(@Body() dto: PriceConfigDto, @CurrentUser() user: AuthUser) {
    if (!user.tenantId) throw new BadRequestException('Usuário sem cliente vinculado');
    return this.service.save(user.tenantId, dto, { canToggle: user.role === 'admin', actor: user.email });
  }
}
