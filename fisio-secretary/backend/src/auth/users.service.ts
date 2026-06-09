import { Injectable, Logger, NotFoundException, OnApplicationBootstrap, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { User, UserRole } from '../common/entities/user.entity';

@Injectable()
export class UsersService implements OnApplicationBootstrap {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private readonly repo: Repository<User>,
    private readonly config: ConfigService,
  ) {}

  // Seed idempotente: cria o admin da plataforma a partir de env vars, se ainda não existir.
  // SEED_ADMIN_EMAIL + SEED_ADMIN_PASSWORD (opcional SEED_ADMIN_TENANT_ID).
  async onApplicationBootstrap() {
    const email = this.config.get('SEED_ADMIN_EMAIL');
    const password = this.config.get('SEED_ADMIN_PASSWORD');
    if (!email || !password) return;

    const existing = await this.findByEmail(email);
    if (existing) return;

    await this.create({
      email,
      password,
      name: 'Admin',
      // string vazia ("") vira null — coluna é uuid e rejeita ""
      tenantId: this.config.get('SEED_ADMIN_TENANT_ID') || null,
      role: 'admin',
    });
    this.logger.log(`[SEED] Usuário admin criado: ${email}`);
  }

  findByEmail(email: string): Promise<User | null> {
    return this.repo.findOne({ where: { email: email.toLowerCase().trim() } });
  }

  findById(id: string): Promise<User | null> {
    return this.repo.findOne({ where: { id } });
  }

  async create(params: {
    email: string;
    password: string;
    name?: string | null;
    tenantId?: string | null;
    role?: UserRole;
  }): Promise<User> {
    const passwordHash = await bcrypt.hash(params.password, 10);
    const user = this.repo.create({
      email: params.email.toLowerCase().trim(),
      passwordHash,
      name: params.name ?? null,
      tenantId: params.tenantId || null, // "" vira null (coluna uuid)
      role: params.role ?? 'operator',
    });
    return this.repo.save(user);
  }

  async validatePassword(user: User, password: string): Promise<boolean> {
    return bcrypt.compare(password, user.passwordHash);
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.findById(userId);
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    const ok = await this.validatePassword(user, currentPassword);
    if (!ok) throw new UnauthorizedException('Senha atual incorreta.');
    user.passwordHash = await bcrypt.hash(newPassword, 10);
    await this.repo.save(user);
  }

  // Admin reseta a senha de qualquer usuário (sem exigir a senha atual).
  async resetPassword(userId: string, newPassword: string): Promise<void> {
    const user = await this.findById(userId);
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    user.passwordHash = await bcrypt.hash(newPassword, 10);
    await this.repo.save(user);
  }

  findByTenant(tenantId: string): Promise<User[]> {
    return this.repo.find({ where: { tenantId }, order: { createdAt: 'ASC' } });
  }

  listAll(): Promise<User[]> {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  countByTenant(tenantId: string): Promise<number> {
    return this.repo.count({ where: { tenantId } });
  }

  async deleteByTenant(tenantId: string): Promise<void> {
    await this.repo.delete({ tenantId });
  }
}
