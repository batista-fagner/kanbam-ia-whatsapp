import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AgendaIntegration, TrinksCatalog } from '../../common/entities/agenda-integration.entity';
import { AgendaServiceEntity } from '../../common/entities/agenda-service.entity';
import { Appointment } from '../../common/entities/appointment.entity';
import { TenantSchedule } from '../../common/entities/tenant-schedule.entity';
import { decryptSecret, encryptSecret } from '../../common/utils/secret-box';
import { SalonAlertNotifier } from '../agenda-notifier';
import { TrinksClient, TrinksUnavailableError } from './trinks.client';
import { suggestTrinksService } from './trinks-match';

export const TRINKS_MONTHLY_LIMIT = 5000;
const STOP_AT = Math.floor(TRINKS_MONTHLY_LIMIT * 0.95); // guarda 5% pra lembretes/cancelamentos manuais
const WARN_AT = Math.floor(TRINKS_MONTHLY_LIMIT * 0.8);

export type LinkStatus = 'approved' | 'pending' | 'unlinked' | 'changed';

export interface ServiceLinkView {
  id: string;
  name: string;
  active: boolean;
  externalId: string | null;
  externalName: string | null;
  externalDurationMinutes: number | null;
  approvedAt: Date | null;
  approvedBy: string | null;
  status: LinkStatus;
  problem: string | null;
  suggestion: { id: number; nome: string; duracaoEmMinutos: number } | null;
}

// Conexão com a Trinks por cliente: chave, catálogo copiado, ligação/aprovação dos serviços e cota.
@Injectable()
export class TrinksIntegrationService implements OnModuleInit {
  private readonly logger = new Logger('TrinksIntegration');

  constructor(
    @InjectRepository(AgendaIntegration) private readonly repo: Repository<AgendaIntegration>,
    @InjectRepository(AgendaServiceEntity) private readonly serviceRepo: Repository<AgendaServiceEntity>,
    @InjectRepository(Appointment) private readonly apptRepo: Repository<Appointment>,
    @InjectRepository(TenantSchedule) private readonly scheduleRepo: Repository<TenantSchedule>,
    private readonly salon: SalonAlertNotifier,
    private readonly dataSource: DataSource,
  ) {}

  onModuleInit() {
    if (!process.env.INTEGRATIONS_ENC_KEY) this.logger.warn('INTEGRATIONS_ENC_KEY ausente — a integração com a Trinks não consegue ler/salvar a chave');
  }

  // ───────── Conexão ─────────

  async getIntegration(tenantId: string): Promise<AgendaIntegration | null> {
    return this.repo.findOne({ where: { tenantId } });
  }

  // Cliente HTTP pronto, contando a cota. Lança TrinksUnavailableError se não estiver conectado.
  // `bulk`: cópia do catálogo (muitas chamadas seguidas) — espaça 1,1 s entre elas e espera mais
  // no 429. Na conversa com a cliente o padrão é curto pra não travar a resposta da IA.
  async clientFor(tenantId: string, opts: { bulk?: boolean } = {}): Promise<{ client: TrinksClient; integration: AgendaIntegration }> {
    const row = await this.repo.createQueryBuilder('i').addSelect('i.apiKeyEnc').where('i.tenant_id = :tenantId', { tenantId }).getOne();
    if (!row?.apiKeyEnc || !row.establishmentId) throw new TrinksUnavailableError('not_connected', 'Trinks não conectada');
    let apiKey: string;
    try {
      apiKey = decryptSecret(row.apiKeyEnc);
    } catch (err) {
      throw new TrinksUnavailableError('not_connected', `Não deu pra ler a chave da Trinks: ${(err as Error).message}`);
    }
    const client = new TrinksClient(
      { apiKey, establishmentId: row.establishmentId },
      opts.bulk
        ? { beforeCall: () => this.countCall(tenantId), minIntervalMs: 1100, rateLimitRetries: 4, maxRateLimitWaitMs: 15000 }
        : { beforeCall: () => this.countCall(tenantId), minIntervalMs: 250, rateLimitRetries: 1, maxRateLimitWaitMs: 3000 },
    );
    return { client, integration: row };
  }

  // Conta 1 chamada no mês (UTC, igual à Trinks). Passou de 95% → para de chamar.
  async countCall(tenantId: string): Promise<void> {
    const month = new Date().toISOString().slice(0, 7);
    const rows = await this.dataSource.query(
      `UPDATE agenda_integrations
          SET usage_count = CASE WHEN usage_month = $2 THEN usage_count + 1 ELSE 1 END,
              usage_month = $2
        WHERE tenant_id = $1
        RETURNING usage_count`,
      [tenantId, month],
    );
    const count = Number(rows?.[0]?.usage_count ?? rows?.[0]?.[0]?.usage_count ?? 0);
    if (count === WARN_AT) {
      void this.salon.notifySalon(tenantId, `⚠️ *Agenda Trinks*: já usamos ${WARN_AT} de ${TRINKS_MONTHLY_LIMIT} consultas do mês. Perto do limite a IA para de agendar e passa para a equipe.`);
    }
    if (count > STOP_AT) {
      if (count === STOP_AT + 1) void this.salon.notifySalon(tenantId, '⚠️ *Agenda Trinks*: limite de consultas do mês atingido. Até o mês virar, a IA não agenda — ela avisa a cliente que a equipe confirma o horário.');
      throw new TrinksUnavailableError('quota', `Cota mensal da Trinks quase no fim (${count}/${TRINKS_MONTHLY_LIMIT})`);
    }
  }

  // Salva a chave (criptografada), descobre o estabelecimento e já copia o catálogo.
  async connect(tenantId: string, apiKeyRaw: string): Promise<Awaited<ReturnType<TrinksIntegrationService['status']>>> {
    const apiKey = (apiKeyRaw ?? '').trim();
    if (apiKey.length < 20 || /\s/.test(apiKey)) throw new BadRequestException('Chave da Trinks inválida');
    const probe = new TrinksClient({ apiKey, establishmentId: null });
    let establishments: { id: number; nome: string }[];
    try {
      establishments = (await probe.listEstablishments())?.data ?? [];
    } catch (err) {
      throw new BadRequestException(`A Trinks recusou essa chave: ${(err as Error).message}`);
    }
    if (establishments.length !== 1) {
      throw new BadRequestException(establishments.length ? `Essa chave tem ${establishments.length} estabelecimentos — fale com o suporte para escolher o certo` : 'Essa chave não tem nenhum estabelecimento na Trinks');
    }
    const est = establishments[0];
    const existing = await this.repo.findOne({ where: { tenantId } });
    await this.repo.save(this.repo.create({
      ...(existing ?? {}),
      tenantId,
      provider: 'trinks',
      apiKeyEnc: encryptSecret(apiKey),
      establishmentId: String(est.id),
      establishmentName: (est.nome ?? '').trim() || null,
      lastError: null,
      lastErrorAt: null,
    }));
    this.logger.log(`[TRINKS] Conectada — tenant ${tenantId}, estabelecimento ${est.id}`);
    await this.syncCatalog(tenantId, true).catch((err) => this.recordError(tenantId, err));
    return this.status(tenantId);
  }

  async testConnection(tenantId: string): Promise<{ ok: boolean; establishmentName: string | null; error: string | null }> {
    try {
      const { client } = await this.clientFor(tenantId);
      const list = (await client.listEstablishments())?.data ?? [];
      const integ = await this.repo.findOne({ where: { tenantId } });
      const mine = list.find((e) => String(e.id) === integ?.establishmentId);
      if (!mine) return { ok: false, establishmentName: null, error: 'A chave não dá mais acesso a este estabelecimento' };
      return { ok: true, establishmentName: mine.nome?.trim() ?? null, error: null };
    } catch (err) {
      return { ok: false, establishmentName: null, error: (err as Error).message };
    }
  }

  // Desconecta: apaga a chave e devolve a cliente pra agenda do CRM, com a IA proibida de agendar.
  async disconnect(tenantId: string): Promise<void> {
    await this.repo.delete({ tenantId });
    const schedule = await this.scheduleRepo.findOne({ where: { tenantId } });
    if (schedule?.mode === 'trinks') {
      schedule.mode = 'professionals';
      schedule.enabled = false;
      await this.scheduleRepo.save(schedule);
    }
    this.logger.log(`[TRINKS] Desconectada — tenant ${tenantId}`);
  }

  async setAutoConfirm(tenantId: string, value: boolean): Promise<void> {
    const r = await this.repo.update({ tenantId }, { autoConfirm: !!value });
    if (!r.affected) throw new NotFoundException('Trinks não conectada');
  }

  async status(tenantId: string) {
    const integ = await this.repo.findOne({ where: { tenantId } });
    const schedule = await this.scheduleRepo.findOne({ where: { tenantId } });
    const month = new Date().toISOString().slice(0, 7);
    return {
      connected: !!integ?.establishmentId,
      establishmentName: integ?.establishmentName ?? null,
      autoConfirm: integ?.autoConfirm ?? false,
      catalogSyncedAt: integ?.catalogSyncedAt ?? null,
      catalogCounts: integ?.catalog ? { services: integ.catalog.services.length, professionals: integ.catalog.professionals.length } : null,
      usage: { month, count: integ?.usageMonth === month ? integ.usageCount : 0, limit: TRINKS_MONTHLY_LIMIT, stopAt: STOP_AT },
      lastError: integ?.lastError ?? null,
      lastErrorAt: integ?.lastErrorAt ?? null,
      mode: schedule?.mode ?? 'simple',
      enabled: schedule?.enabled ?? false,
      minNoticeHours: schedule?.minNoticeHours ?? 2,
      bookingWindowDays: schedule?.bookingWindowDays ?? 14,
    };
  }

  async recordError(tenantId: string, err: unknown): Promise<void> {
    const msg = (err as Error)?.message ?? String(err);
    this.logger.warn(`[TRINKS] ${msg} — tenant ${tenantId}`);
    await this.repo.update({ tenantId }, { lastError: msg.slice(0, 500), lastErrorAt: new Date() }).catch(() => undefined);
  }

  // ───────── Catálogo ─────────

  // Copia serviços e profissionais (com agenda e ativos) da Trinks. `withProfessionalServices`
  // relê quem faz o quê (1 chamada por profissional) — no botão e 1x por semana.
  async syncCatalog(tenantId: string, withProfessionalServices = true): Promise<TrinksCatalog> {
    const { client, integration } = await this.clientFor(tenantId, { bulk: true });
    const services = (await client.listServices())
      .map((s) => ({ id: s.id, nome: (s.nome ?? '').trim(), duracaoEmMinutos: Number(s.duracaoEmMinutos) || 0, preco: s.preco ?? null }));
    const previous = new Map((integration.catalog?.professionals ?? []).map((p) => [p.id, p.serviceIds]));
    const profs = (await client.listProfessionals()).filter((p) => p.possuiAgenda && String(p.status ?? '').toLowerCase() === 'ativo');
    const professionals: TrinksCatalog['professionals'] = [];
    for (const p of profs) {
      let serviceIds: number[] | null = previous.get(p.id) ?? null;
      if (withProfessionalServices || serviceIds === null) {
        try {
          serviceIds = (await client.listProfessionalServices(p.id)).map((s) => s.id);
        } catch (err) {
          if (err instanceof TrinksUnavailableError && err.reason !== 'down') throw err;
          serviceIds = previous.get(p.id) ?? null;
        }
      }
      // Sem CPF ou outros dados pessoais: só o necessário pra agendar.
      professionals.push({ id: p.id, nome: (p.nome ?? '').trim(), apelido: p.apelido?.trim() || null, serviceIds });
    }
    const catalog: TrinksCatalog = { services, professionals };
    await this.repo.update({ tenantId }, { catalog, catalogSyncedAt: new Date(), lastError: null, lastErrorAt: null });
    await this.reconcileLinks(tenantId, catalog);
    this.logger.log(`[TRINKS] Catálogo copiado — tenant ${tenantId}: ${services.length} serviços, ${professionals.length} profissionais`);
    return catalog;
  }

  // Serviço ligado que sumiu, mudou de nome ou de duração na Trinks perde a aprovação.
  private async reconcileLinks(tenantId: string, catalog: TrinksCatalog): Promise<void> {
    const linked = await this.serviceRepo.find({ where: { tenantId } });
    for (const svc of linked) {
      if (!svc.externalId) continue;
      const ext = catalog.services.find((s) => String(s.id) === svc.externalId);
      const changed = !ext || ext.nome !== svc.externalName || ext.duracaoEmMinutos !== svc.externalDurationMinutes;
      if (!changed) continue;
      await this.serviceRepo.update({ id: svc.id }, {
        externalName: ext ? ext.nome : svc.externalName,
        externalDurationMinutes: ext ? ext.duracaoEmMinutos : svc.externalDurationMinutes,
        approvedAt: null,
        approvedBy: null,
      });
      if (svc.approvedAt) {
        this.logger.warn(`[TRINKS] "${svc.name}" perdeu a aprovação (${ext ? 'mudou na Trinks' : 'sumiu da Trinks'}) — tenant ${tenantId}`);
      }
    }
  }

  @Cron('0 6 * * *', { timeZone: 'America/Sao_Paulo' })
  async dailySync(): Promise<void> {
    const rows = await this.repo.find();
    const monday = new Date().getDay() === 1;
    for (const r of rows) {
      try {
        await this.syncCatalog(r.tenantId, monday || !r.catalogSyncedAt);
      } catch (err) {
        await this.recordError(r.tenantId, err);
      }
    }
  }

  // ───────── Ligação e aprovação dos serviços ─────────

  async listServiceLinks(tenantId: string): Promise<ServiceLinkView[]> {
    const integ = await this.repo.findOne({ where: { tenantId } });
    const catalog = integ?.catalog ?? null;
    const services = await this.serviceRepo.find({ where: { tenantId }, order: { sortOrder: 'ASC', createdAt: 'ASC' } });
    return services.map((s) => {
      const ext = s.externalId ? catalog?.services.find((c) => String(c.id) === s.externalId) ?? null : null;
      let status: LinkStatus;
      let problem: string | null = null;
      if (!s.externalId) status = 'unlinked';
      else if (!ext) { status = 'changed'; problem = 'Esse serviço não existe mais na Trinks'; }
      else if (!ext.duracaoEmMinutos) { status = 'changed'; problem = 'Duração zerada na Trinks — corrija lá antes de aprovar'; }
      else if (!catalogHasProfessionalFor(catalog, ext.id)) { status = 'changed'; problem = 'Nenhum profissional faz esse serviço na Trinks'; }
      else status = s.approvedAt ? 'approved' : 'pending';
      const sug = !s.externalId && catalog ? suggestTrinksService(s.name, catalog.services) : null;
      return {
        id: s.id,
        name: s.name,
        active: s.active,
        externalId: s.externalId,
        externalName: ext?.nome ?? s.externalName,
        externalDurationMinutes: ext?.duracaoEmMinutos ?? s.externalDurationMinutes,
        approvedAt: s.approvedAt,
        approvedBy: s.approvedBy,
        status,
        problem,
        suggestion: sug ? { id: sug.item.id, nome: sug.item.nome, duracaoEmMinutos: sug.item.duracaoEmMinutos } : null,
      };
    });
  }

  catalogServices(integ: AgendaIntegration | null) {
    return (integ?.catalog?.services ?? []).map((s) => ({ id: s.id, nome: s.nome, duracaoEmMinutos: s.duracaoEmMinutos }));
  }

  async linkService(tenantId: string, serviceId: string, externalId: string | number | null): Promise<void> {
    const svc = await this.serviceRepo.findOne({ where: { id: serviceId, tenantId } });
    if (!svc) throw new NotFoundException('Serviço não encontrado');
    if (externalId === null || externalId === '') {
      await this.serviceRepo.update({ id: svc.id }, { externalId: null, externalName: null, externalDurationMinutes: null, approvedAt: null, approvedBy: null });
      return;
    }
    const integ = await this.repo.findOne({ where: { tenantId } });
    const ext = integ?.catalog?.services.find((c) => String(c.id) === String(externalId));
    if (!ext) throw new BadRequestException('Serviço da Trinks não encontrado — clique em "Atualizar da Trinks"');
    await this.serviceRepo.update({ id: svc.id }, {
      externalId: String(ext.id),
      externalName: ext.nome,
      externalDurationMinutes: ext.duracaoEmMinutos,
      approvedAt: null,
      approvedBy: null,
    });
  }

  async approveService(tenantId: string, serviceId: string, userEmail: string | null): Promise<void> {
    const view = (await this.listServiceLinks(tenantId)).find((v) => v.id === serviceId);
    if (!view) throw new NotFoundException('Serviço não encontrado');
    if (view.status === 'unlinked') throw new BadRequestException('Escolha o serviço da Trinks antes de aprovar');
    if (view.status === 'changed') throw new BadRequestException(view.problem ?? 'Ligação com a Trinks precisa ser revista');
    if (!view.active) throw new BadRequestException('Serviço desativado — reative antes de aprovar');
    await this.serviceRepo.update({ id: serviceId, tenantId }, { approvedAt: new Date(), approvedBy: userEmail || 'desconhecido' });
    this.logger.log(`[TRINKS] "${view.name}" aprovado por ${userEmail} — tenant ${tenantId}`);
  }

  async unapproveService(tenantId: string, serviceId: string): Promise<void> {
    const r = await this.serviceRepo.update({ id: serviceId, tenantId }, { approvedAt: null, approvedBy: null });
    if (!r.affected) throw new NotFoundException('Serviço não encontrado');
  }

  // Serviços que a IA pode agendar: ativos, ligados, aprovados e ainda válidos na Trinks.
  async approvedServices(tenantId: string): Promise<AgendaServiceEntity[]> {
    const views = await this.listServiceLinks(tenantId);
    const ok = views.filter((v) => v.status === 'approved' && v.active).map((v) => v.id);
    if (!ok.length) return [];
    const rows = await this.serviceRepo.find({ where: { tenantId, id: In(ok) }, order: { sortOrder: 'ASC', createdAt: 'ASC' } });
    // A duração que vale é a da Trinks (é ela que ocupa a agenda lá).
    for (const r of rows) if (r.externalDurationMinutes) r.durationMinutes = r.externalDurationMinutes;
    return rows;
  }

  // ───────── Histórico ─────────

  async aiLog(tenantId: string, limit = 100) {
    const rows = await this.apptRepo.find({
      where: { tenantId, externalProvider: 'trinks' },
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 300),
      relations: ['lead'],
    });
    return rows.map((a) => ({
      id: a.id,
      createdAt: a.createdAt,
      startDateTime: a.startDateTime,
      clientName: a.clientName,
      clientPhone: a.clientPhone,
      service: a.service,
      professional: a.externalProfessionalName,
      status: a.status,
      externalId: a.externalId,
      notes: a.notes,
      leadId: a.leadId,
    }));
  }
}

export function catalogHasProfessionalFor(catalog: TrinksCatalog | null, serviceId: number): boolean {
  if (!catalog) return false;
  return catalog.professionals.some((p) => Array.isArray(p.serviceIds) && p.serviceIds.includes(serviceId));
}
