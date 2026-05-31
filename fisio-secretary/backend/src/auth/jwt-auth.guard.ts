import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// Protege rotas: exige um JWT válido no header Authorization: Bearer <token>.
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
