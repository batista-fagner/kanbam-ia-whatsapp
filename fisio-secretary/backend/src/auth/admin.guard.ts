import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

// Permite acesso apenas a usuários com role 'admin'. Usar SEMPRE junto do JwtAuthGuard
// (que popula req.user a partir do JWT): @UseGuards(JwtAuthGuard, AdminGuard)
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    if (req.user?.role !== 'admin') {
      throw new ForbiddenException('Acesso restrito ao administrador.');
    }
    return true;
  }
}
