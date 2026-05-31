import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UsersService } from './users.service';
import { User } from '../common/entities/user.entity';
import { WhatsappConfig } from '../common/entities/whatsapp-config.entity';

export interface JwtPayload {
  sub: string;       // user id
  email: string;
  tenantId: string | null;
  role: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    @InjectRepository(WhatsappConfig)
    private readonly configRepo: Repository<WhatsappConfig>,
  ) {}

  async validateUser(email: string, password: string): Promise<User> {
    const user = await this.usersService.findByEmail(email);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('E-mail ou senha incorretos.');
    }
    const ok = await this.usersService.validatePassword(user, password);
    if (!ok) {
      throw new UnauthorizedException('E-mail ou senha incorretos.');
    }
    // Cliente suspenso (inadimplência): bloqueia login. Admin nunca é bloqueado.
    if (user.role !== 'admin' && user.tenantId) {
      const tenant = await this.configRepo.findOne({ where: { id: user.tenantId } });
      if (tenant && tenant.isActive === false) {
        throw new UnauthorizedException('Conta suspensa. Entre em contato com o suporte.');
      }
    }
    return user;
  }

  async login(email: string, password: string) {
    const user = await this.validateUser(email, password);
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      tenantId: user.tenantId,
      role: user.role,
    };
    return {
      access_token: await this.jwtService.signAsync(payload),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        tenantId: user.tenantId,
        role: user.role,
      },
    };
  }
}
