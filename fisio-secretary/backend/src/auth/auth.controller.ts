import { BadRequestException, Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UsersService } from './users.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';
import type { AuthUser } from './jwt.strategy';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
  ) {}

  @Post('login')
  async login(@Body() body: { email: string; password: string }) {
    return this.authService.login(body.email, body.password);
  }

  // Retorna o usuário do token — usado pelo frontend para reidratar a sessão no refresh.
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser() authUser: AuthUser) {
    const user = await this.usersService.findById(authUser.userId);
    if (!user) return null;
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      tenantId: user.tenantId,
      role: user.role,
    };
  }

  // Usuário troca a própria senha (precisa da senha atual).
  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  async changePassword(
    @CurrentUser() authUser: AuthUser,
    @Body() body: { currentPassword: string; newPassword: string },
  ) {
    if (!body.newPassword || body.newPassword.length < 5) {
      throw new BadRequestException('A nova senha deve ter pelo menos 5 caracteres.');
    }
    await this.usersService.changePassword(authUser.userId, body.currentPassword, body.newPassword);
    return { ok: true };
  }
}
