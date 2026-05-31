import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtPayload } from './auth.service';
import { WhatsappConfig } from '../common/entities/whatsapp-config.entity';

// O retorno de validate() vira req.user em rotas protegidas pelo JwtAuthGuard.
export interface AuthUser {
  userId: string;
  email: string;
  tenantId: string | null;
  role: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    @InjectRepository(WhatsappConfig)
    private readonly configRepo: Repository<WhatsappConfig>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_SECRET') ?? 'dev-secret-change-me',
    });
  }

  async validate(payload: JwtPayload): Promise<AuthUser> {
    if (!payload?.sub) throw new UnauthorizedException();

    // Admin nunca é bloqueado por suspensão de tenant.
    if (payload.role !== 'admin' && payload.tenantId) {
      const tenant = await this.configRepo.findOne({ where: { id: payload.tenantId } });
      if (!tenant || !tenant.isActive) {
        throw new UnauthorizedException('Conta suspensa');
      }
    }

    return {
      userId: payload.sub,
      email: payload.email,
      tenantId: payload.tenantId,
      role: payload.role,
    };
  }
}
