import { Injectable, Logger, BadRequestException, NotFoundException, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual, IsNull } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { Followup } from '../common/entities/followup.entity';
import { WhatsappConfig } from '../common/entities/whatsapp-config.entity';
import { Agent } from '../common/entities/agent.entity';
import { Lead, LeadStage } from '../common/entities/lead.entity';
import { Appointment } from '../common/entities/appointment.entity';
import { LeadsService } from '../leads/leads.service';
import { LeadsGateway } from '../leads/leads.gateway';
import { AiService } from '../ai/ai.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { FollowupQueueService } from './followup-queue.service';
import { AppointmentReminderJob, CadenceStepJob, FollowupTriggerQueueService, IdleCheckJob } from './followup-trigger-queue.service';
import { followupTriggers, FollowupTrigger } from '../common/followup-triggers';
import { QUEUE_ENGINE_BULLMQ } from '../queue/queue.constants';
import { resolveReminderGate } from '../appointments/reminder-gate';

// Delays permitidos (horas). O front oferece 1h / 4h / 24h.
const ALLOWED_DELAYS = [1, 4, 24];

// ── Proteção anti-bloqueio do WhatsApp (envios automáticos) ──
// Janela de horário comercial (BRT): só envia follow-up entre 9h e 20h.
const BUSINESS_START_HOUR = 9;
const BUSINESS_END_HOUR = 20; // envia até 19:59; às 20h em diante, para.
// Quantos follow-ups no MÁXIMO por execução do cron (a cada minuto). Evita rajada.
const SEND_BATCH_PER_RUN = 5;
// Espaçamento aleatório entre cada envio dentro do lote (ms) — imita ritmo humano.
const MIN_GAP_MS = 7000;
const MAX_GAP_MS = 15000;
// Espaçamento MÍNIMO entre envios do MESMO tenant — espalha os follow-ups ao longo
// do dia (1 a cada 3 min) em vez de deixá-los saírem em rajada. Anti-bloqueio.
const MIN_TENANT_SEND_GAP_MS = 3 * 60 * 1000;
// Candidatos lidos por execução do cron; o nº REAL de envios é limitado por
// SEND_BATCH_PER_RUN. Pool amplo evita que um tenant com backlog monopolize o lote.
const DUE_POOL_SIZE = 200;
// Teto diário padrão por tenant, usado se a config não tiver valor.
const DEFAULT_FOLLOWUP_DAILY_LIMIT = 40;

// ── Follow-up por evento (QUEUE_ENGINE=bullmq) ──
// Raias que têm follow-up automático por inatividade (Regras de Alertas).
const AUTO_FOLLOWUP_STAGES: LeadStage[] = ['novo_lead', 'lead_frio', 'lead_quente'] as LeadStage[];
// Config por tenant em memória: toda mensagem enviada emite gatilho, e sem cache cada uma
// leria a whatsapp_config. Salvar em Regras de Alertas invalida na hora; mudança feita
// direto no banco (cadência) vale em até 1 min.
const CONFIG_CACHE_MS = 60_000;
// Varredura única da subida espera o boot assentar (webhook/IA primeiro).
const BOOT_BACKFILL_DELAY_MS = 30_000;
type AutoRule = { enabled: boolean; idleMinutes: number; message: string; activeSince?: string };

// Lead só entra no follow-up por inatividade se a última mensagem (nossa) for de depois
// que a raia foi ligada. Regra sem activeSince (gravada direto no banco) não dispara.
const isAfterActivation = (rule: AutoRule, messageAt: Date): boolean =>
  !!rule.activeSince && new Date(messageAt).getTime() >= Date.parse(rule.activeSince);

// Follow-up "com conhecimento": em vez do template fixo configurado na tela de
// alertas, gera a mensagem com IA usando o system_prompt real do agente que
// estava atendendo (voz + regras + base de conhecimento) + a conversa até onde
// parou. Só pra tenants de teste habilitados — nos demais, comportamento
// idêntico ao de sempre (template fixo + spin).
const AGENT_AWARE_FOLLOWUP_TENANT_IDS = ['1ff3f0b3-52d1-4e89-b7bf-552d0556de29']; // claudia_teste@hotmail.com

// Janela de horário customizada por tenant — especificação real do cliente Marcel
// (Pro Cleaning, tenant claudia_teste): follow-up automático em horários diferentes
// por dia da semana (não o padrão 9h-20h do resto do sistema). Só afeta o
// FOLLOW-UP AUTOMÁTICO — a resposta ao vivo da IA no chat nunca é restrita por
// horário, isso é intencional (confirmado com o usuário 2026-07-24).
interface FollowupWindow { start: number; end: number }
const TENANT_FOLLOWUP_WINDOW_OVERRIDES: Record<string, { weekday: FollowupWindow; saturday: FollowupWindow; sunday: FollowupWindow }> = {
  '1ff3f0b3-52d1-4e89-b7bf-552d0556de29': {
    weekday: { start: 18, end: 22 },
    saturday: { start: 11, end: 17 },
    sunday: { start: 15, end: 18 },
  },
};

@Injectable()
export class FollowupService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(FollowupService.name);
  private readonly configCache = new Map<string, { cfg: WhatsappConfig | null; at: number }>();

  constructor(
    @InjectRepository(Followup)
    private readonly followupRepo: Repository<Followup>,
    @InjectRepository(WhatsappConfig)
    private readonly configRepo: Repository<WhatsappConfig>,
    @InjectRepository(Agent)
    private readonly agentRepo: Repository<Agent>,
    private readonly leadsService: LeadsService,
    private readonly leadsGateway: LeadsGateway,
    private readonly aiService: AiService,
    private readonly config: ConfigService,
    private readonly http: HttpService,
    private readonly appointmentsService: AppointmentsService,
    private readonly followupQueue: FollowupQueueService,
    private readonly triggerQueue: FollowupTriggerQueueService,
  ) {}

  // Modo fila: passa a ouvir os gatilhos (salvar mensagem, mudar raia, religar IA,
  // agendamento, config) e faz UMA varredura para enfileirar quem já estava na fila de
  // espera antes do deploy. No legado nada disso liga e os crons seguem como antes.
  onApplicationBootstrap(): void {
    if (!this.queueMode) return;
    followupTriggers.setListener((t) => {
      void this.onTrigger(t).catch((err) =>
        this.logger.error(`[FU-TRIGGER] Falha ao agendar (${t.kind}): ${err?.message ?? err}`));
    });
    setTimeout(() => {
      void this.backfillAll().catch((err) =>
        this.logger.error(`[FU-TRIGGER] Falha na varredura da subida: ${err?.message ?? err}`));
    }, BOOT_BACKFILL_DELAY_MS).unref?.();
  }

  onModuleDestroy(): void {
    followupTriggers.setListener(null);
  }

  private get queueMode(): boolean {
    return this.config.get<string>('QUEUE_ENGINE') === QUEUE_ENGINE_BULLMQ;
  }

  // ───────────────────────── API ─────────────────────────

  // Gera uma sugestão de mensagem com a IA (modelo lite) a partir da conversa do lead.
  async generateSuggestion(leadId: string, tenantId: string): Promise<{ text: string }> {
    const lead = await this.leadsService.findOne(leadId, tenantId);
    if (!lead) throw new NotFoundException('Lead não encontrado');

    const config = await this.configRepo.findOne({ where: { id: tenantId } });

    if (AGENT_AWARE_FOLLOWUP_TENANT_IDS.includes(tenantId) && config?.multiAgentEnabled) {
      const agentAware = await this.buildAgentAwareFollowupMessage(tenantId, lead);
      if (agentAware) return { text: agentAware };
    }

    const businessName = config?.displayName?.trim() || 'a empresa';
    const conversation = await this.leadsService.getConversationWithMessages(leadId, tenantId);
    const transcript = this.buildTranscript(conversation?.messages ?? []);
    const text = await this.aiService.generateFollowupSuggestion(lead.name, transcript, businessName, config?.agentType);
    return { text };
  }

  // Agenda um follow-up. delayHours: 1 | 4 | 24 (a partir de agora).
  async schedule(leadId: string, tenantId: string, message: string, delayHours: number): Promise<Followup> {
    const text = (message ?? '').trim();
    if (!text) throw new BadRequestException('Mensagem é obrigatória');
    if (!ALLOWED_DELAYS.includes(delayHours)) {
      throw new BadRequestException('Tempo inválido (use 1, 4 ou 24 horas)');
    }
    const lead = await this.leadsService.findOne(leadId, tenantId);
    if (!lead) throw new NotFoundException('Lead não encontrado');

    const scheduledAt = new Date(Date.now() + delayHours * 3600_000);
    const followup = this.followupRepo.create({
      tenantId,
      leadId,
      phone: lead.phone,
      message: text,
      scheduledAt,
      status: 'pending',
    });
    const saved = await this.followupRepo.save(followup);
    await this.followupQueue.enqueue(saved.id, saved.scheduledAt);
    this.logger.log(`[FOLLOWUP] Agendado p/ ${lead.phone} em ${delayHours}h (${scheduledAt.toISOString()})`);
    return saved;
  }

  // Lista os follow-ups pendentes de um lead (mostrados no modal).
  async listForLead(leadId: string, tenantId: string): Promise<Followup[]> {
    return this.followupRepo.find({
      where: { leadId, tenantId, status: 'pending' },
      order: { scheduledAt: 'ASC' },
    });
  }

  // Cancela um follow-up pendente.
  async cancel(id: string, tenantId: string): Promise<{ ok: boolean }> {
    const followup = await this.followupRepo.findOne({ where: { id, tenantId } });
    if (!followup) throw new NotFoundException('Follow-up não encontrado');
    if (followup.status === 'pending') {
      followup.status = 'canceled';
      await this.followupRepo.save(followup);
    }
    // Sem guard de engine: remover jobId inexistente é no-op. O processor também confere
    // o status antes de enviar, então cancelar é seguro mesmo com o job já em execução.
    await this.followupQueue.cancel(id);
    return { ok: true };
  }

  // Reivindica e envia UM follow-up — mesma sequência do processDue(), extraída para o
  // processor da fila usar. O claim atômico continua sendo a garantia contra envio duplo:
  // o BullMQ pode reentregar um job (worker morto, redeploy), e só quem flipa
  // pending → sending no Postgres é que envia de fato.
  async claimAndSend(f: Followup): Promise<'sent' | 'already-claimed'> {
    const claim = await this.followupRepo
      .createQueryBuilder()
      .update(Followup)
      .set({ status: 'sending' as any })
      .where('id = :id AND status = :pending', { id: f.id, pending: 'pending' })
      .execute();

    if (claim.affected !== 1) return 'already-claimed';

    try {
      await this.send(f);
      f.status = 'sent';
      f.sentAt = new Date();
      f.error = null;
      await this.followupRepo.save(f);
      this.logger.log(`[FOLLOWUP] Enviado → ${f.phone} (lead ${f.leadId})`);
      return 'sent';
    } catch (err) {
      // Devolve pra 'pending' e propaga: quem decide se ainda há tentativa é o BullMQ
      // (attempts/backoff). Marcar 'failed' aqui impediria o retry de reivindicar de novo.
      f.status = 'pending';
      f.error = err?.message ?? 'erro desconhecido';
      await this.followupRepo.save(f);
      this.logger.error(`[FOLLOWUP] Falha ao enviar p/ ${f.phone}: ${f.error}`);
      throw err;
    }
  }

  // ───────────────────────── Cron ─────────────────────────

  // A cada minuto: envia os follow-ups vencidos (scheduledAt <= agora).
  // Cada follow-up é "reivindicado" com um UPDATE atômico (pending → sending).
  // Só a instância que conseguir afetar a linha envia — evita duplicação em
  // múltiplas instâncias sem depender de Redis.
  @Cron(CronExpression.EVERY_MINUTE)
  async processDue(): Promise<void> {
    if (this.queueMode) return; // quem despacha agora é o FollowupDispatchProcessor
    // PROTEÇÃO 1 — Janela de horário: cada tenant pode ter uma janela diferente
    // (ver TENANT_FOLLOWUP_WINDOW_OVERRIDES), então a checagem é POR FOLLOW-UP
    // (campo tenantId), não um return global no topo. Os vencidos ficam pending
    // e saem quando a janela daquele tenant abrir.
    // PROTEÇÃO 2 — Puxa um pool de candidatos vencidos; o nº REAL de envios por
    // execução é limitado por SEND_BATCH_PER_RUN (sentThisRun). Pool amplo evita que
    // um tenant com backlog grande monopolize o lote e trave os demais.
    const due = await this.followupRepo.find({
      where: { status: 'pending', scheduledAt: LessThanOrEqual(new Date()) },
      order: { scheduledAt: 'ASC' },
      take: DUE_POOL_SIZE,
    });
    if (due.length === 0) return;

    // Cache por execução: enviados hoje, limite e último envio, por tenant.
    const sentTodayByTenant = new Map<string, number>();
    const limitByTenant = new Map<string, number>();
    const lastSentByTenant = new Map<string, Date | null>();
    let sentThisRun = 0;

    for (const f of due) {
      if (sentThisRun >= SEND_BATCH_PER_RUN) break; // teto de envios por execução

      if (!this.isWithinBusinessHours(f.tenantId)) {
        continue; // fora da janela desse tenant — deixa pending
      }

      // PROTEÇÃO 3 — Teto diário por tenant: ao atingir o limite, deixa pending pra amanhã.
      let sentToday = sentTodayByTenant.get(f.tenantId);
      if (sentToday === undefined) {
        sentToday = await this.countSentTodayByTenant(f.tenantId);
        sentTodayByTenant.set(f.tenantId, sentToday);
      }
      let limit = limitByTenant.get(f.tenantId);
      if (limit === undefined) {
        limit = await this.followupDailyLimit(f.tenantId);
        limitByTenant.set(f.tenantId, limit);
      }
      if (sentToday >= limit) {
        this.logger.warn(`[FOLLOWUP] Teto diário atingido (${limit}) p/ tenant ${f.tenantId} — adiando envios`);
        continue;
      }

      // PROTEÇÃO 4 — Espaçamento por tenant: no MÍNIMO 3 min entre um envio e o
      // próximo do mesmo tenant. Espalha os follow-ups pelo dia (anti-rajada) e serve
      // de backoff quando os envios estão falhando (nº bloqueado/desconectado).
      let lastSent = lastSentByTenant.get(f.tenantId);
      if (lastSent === undefined) {
        lastSent = await this.lastSentAtByTenant(f.tenantId);
        lastSentByTenant.set(f.tenantId, lastSent);
      }
      if (lastSent && Date.now() - lastSent.getTime() < MIN_TENANT_SEND_GAP_MS) {
        continue; // ainda dentro do intervalo → deixa pending, tenta no próximo tick
      }

      // Claim atômico: só prossegue se ESTA instância flipou pending → sending.
      const claim = await this.followupRepo
        .createQueryBuilder()
        .update(Followup)
        .set({ status: 'sending' as any })
        .where('id = :id AND status = :pending', { id: f.id, pending: 'pending' })
        .execute();

      if (claim.affected !== 1) {
        // Outra instância já reivindicou este follow-up.
        continue;
      }

      try {
        await this.send(f);
        f.status = 'sent';
        f.sentAt = new Date();
        f.error = null;
        await this.followupRepo.save(f);
        sentTodayByTenant.set(f.tenantId, sentToday + 1); // só sucesso conta pro teto diário
        this.logger.log(`[FOLLOWUP] Enviado → ${f.phone} (lead ${f.leadId})`);
      } catch (err) {
        f.status = 'failed';
        f.error = err?.message ?? 'erro desconhecido';
        await this.followupRepo.save(f);
        this.logger.error(`[FOLLOWUP] Falha ao enviar p/ ${f.phone}: ${f.error}`);
      }

      // Conta a TENTATIVA (sucesso ou falha) e marca o último envio do tenant: aplica
      // o teto por execução e o espaçamento de 3 min mesmo quando o envio falha.
      sentThisRun++;
      lastSentByTenant.set(f.tenantId, new Date());

      // Espaçamento humano entre envios (jitter) — nunca dispara em rajada.
      await this.sleep(MIN_GAP_MS + Math.floor(Math.random() * (MAX_GAP_MS - MIN_GAP_MS)));
    }
  }

  // ───────────────────────── Follow-up por evento (fila) ─────────────────────────
  //
  // Nada aqui varre o banco periodicamente. Cada gatilho (ver common/followup-triggers.ts)
  // agenda UM job com delay para o instante exato; o job relê o banco na hora e decide.
  // Job velho (o lead respondeu, mudou de raia, remarcou) não precisa ser cancelado:
  // a âncora dele (mensagem / next_nurture_at / horário) não bate mais e ele sai sem fazer nada.

  private async onTrigger(t: FollowupTrigger): Promise<void> {
    switch (t.kind) {
      case 'message': {
        // Resposta do lead não agenda inatividade (só conta quando NÓS falamos por último);
        // o relógio da cadência ela já reinicia em resetCadenceOnReply.
        if (t.direction !== 'outbound') return;
        const cfg = await this.getConfigCached(t.tenantId);
        if (!cfg || !this.hasLeadFollowupWork(cfg)) return; // maioria dos tenants: zero consulta
        const lead = await this.leadsService.findOne(t.leadId, t.tenantId);
        if (!lead) return;
        await this.scheduleIdleCheck(cfg, lead, { id: t.messageId, direction: 'outbound', createdAt: t.at });
        await this.scheduleCadenceIfArmed(cfg, lead);
        return;
      }
      case 'stage':
      case 'ai-enabled': {
        const lead = await this.leadsService.findOne(t.leadId, t.kind === 'stage' ? t.tenantId : undefined);
        if (!lead) return;
        const cfg = await this.getConfigCached(lead.tenantId);
        if (!cfg || !this.hasLeadFollowupWork(cfg)) return;
        await this.scheduleIdleCheck(cfg, lead);
        await this.scheduleCadenceIfArmed(cfg, lead);
        return;
      }
      case 'appointment': {
        const appt = await this.appointmentsService.findById(t.appointmentId);
        if (!appt?.tenantId) return;
        const cfg = await this.getConfigCached(appt.tenantId);
        if (cfg) await this.scheduleReminder(cfg, appt);
        return;
      }
      case 'config': {
        this.configCache.delete(t.tenantId);
        const n = await this.backfillTenant(t.tenantId);
        if (n > 0) this.logger.log(`[FU-TRIGGER] Config salva (tenant ${t.tenantId}): ${n} job(s) agendado(s)`);
        return;
      }
    }
  }

  private async getConfigCached(tenantId: string): Promise<WhatsappConfig | null> {
    const hit = this.configCache.get(tenantId);
    if (hit && Date.now() - hit.at < CONFIG_CACHE_MS) return hit.cfg;
    const cfg = await this.configRepo.findOne({ where: { id: tenantId } });
    this.configCache.set(tenantId, { cfg, at: Date.now() });
    return cfg;
  }

  // Regra de inatividade válida para a raia — mesmas condições do cron legado.
  private autoRuleFor(cfg: WhatsappConfig, stage: string): AutoRule | null {
    if (cfg.archivedAt || cfg.autoFollowupEnabled === false) return null;
    if (!AUTO_FOLLOWUP_STAGES.includes(stage as LeadStage)) return null;
    const rule = cfg.autoFollowupConfig?.[stage];
    if (!rule?.enabled || !rule.message?.trim() || !(rule.idleMinutes > 0)) return null;
    return rule;
  }

  private cadenceStepsFor(cfg: WhatsappConfig, stage: string) {
    if (cfg.archivedAt) return null;
    const steps = cfg.followupCadence?.[stage];
    return steps?.length ? steps : null;
  }

  private hasLeadFollowupWork(cfg: WhatsappConfig): boolean {
    if (cfg.archivedAt) return false;
    const hasRule = AUTO_FOLLOWUP_STAGES.some((s) => !!this.autoRuleFor(cfg, s));
    const hasCadence = Object.values(cfg.followupCadence ?? {}).some((steps) => !!steps?.length);
    return hasRule || hasCadence;
  }

  // Agenda o job de inatividade da raia atual, ancorado na última mensagem (nossa).
  private async scheduleIdleCheck(
    cfg: WhatsappConfig,
    lead: Pick<Lead, 'id' | 'stage' | 'phone'> & { autoFollowupSentStages?: string[] },
    last?: { id: string; direction: 'inbound' | 'outbound'; createdAt: Date },
  ): Promise<void> {
    const rule = this.autoRuleFor(cfg, lead.stage);
    if (!rule || !lead.phone || lead.autoFollowupSentStages?.includes(lead.stage)) return;
    const msg = last ?? await this.leadsService.getLastMessageInfo(lead.id);
    if (!msg || msg.direction !== 'outbound' || !isAfterActivation(rule, msg.createdAt)) return;
    const fireAt = new Date(new Date(msg.createdAt).getTime() + rule.idleMinutes * 60_000);
    await this.triggerQueue.scheduleIdleCheck({ tenantId: cfg.id, leadId: lead.id, stage: lead.stage, messageId: msg.id }, fireAt);
  }

  private async scheduleCadenceIfArmed(cfg: WhatsappConfig, lead: Lead): Promise<void> {
    if (!lead.nextNurtureAt || lead.nurturePaused || !this.cadenceStepsFor(cfg, lead.stage)) return;
    await this.triggerQueue.scheduleCadenceStep(
      { tenantId: cfg.id, leadId: lead.id, anchor: new Date(lead.nextNurtureAt).getTime() },
      new Date(lead.nextNurtureAt),
    );
  }

  // Fire-and-forget: chamado de dentro do fluxo de mensagem (resetCadenceOnReply).
  private armCadence(tenantId: string, leadId: string, nextNurtureAt: Date): void {
    void this.triggerQueue
      .scheduleCadenceStep({ tenantId, leadId, anchor: nextNurtureAt.getTime() }, nextNurtureAt)
      .catch((err) => this.logger.error(`[CADENCE] Falha ao agendar job p/ lead ${leadId}: ${err?.message ?? err}`));
  }

  private async scheduleReminder(cfg: WhatsappConfig, appt: Appointment): Promise<void> {
    if (cfg.archivedAt) return;
    const gate = resolveReminderGate(cfg.appointmentReminder);
    if (gate.skip) return;
    if (!['agendado', 'confirmado'].includes(appt.status) || appt.reminderSentAt || !appt.clientPhone) return;
    const start = new Date(appt.startDateTime).getTime();
    // Mesma regra do findDueReminders: em cima da hora não manda lembrete.
    if (start - Date.now() < AppointmentsService.REMINDER_MIN_LEAD_MS) return;
    const fireAt = new Date(start - gate.hoursBefore * 3600_000);
    await this.triggerQueue.scheduleReminder({ appointmentId: appt.id, startMs: start }, gate.hoursBefore, fireAt);
  }

  // Job: lead parado na raia. Mesmas condições do findIdleLeadsForAutoFollowup, para UM lead.
  async runIdleCheck(data: IdleCheckJob): Promise<void> {
    const cfg = await this.configRepo.findOne({ where: { id: data.tenantId } });
    const rule = cfg ? this.autoRuleFor(cfg, data.stage) : null;
    if (!cfg || !rule) return;
    const lead = await this.leadsService.findOne(data.leadId, data.tenantId);
    if (!lead || lead.stage !== data.stage || !lead.phone || lead.autoFollowupSentStages?.includes(data.stage)) return;
    const last = await this.leadsService.getLastMessageInfo(lead.id);
    if (!last || last.id !== data.messageId || last.direction !== 'outbound') return; // teve mensagem depois
    if (!isAfterActivation(rule, last.createdAt)) return; // parou antes de a raia ser ligada (ou religada)
    if (!(await this.leadsService.getAiEnabled(lead.id))) return; // religar a IA reagenda

    const dueAt = last.createdAt.getTime() + rule.idleMinutes * 60_000;
    if (dueAt > Date.now() + 1_000) {
      // Tempo de inatividade aumentou depois do agendamento.
      await this.triggerQueue.scheduleIdleCheck(data, new Date(dueAt), `t${dueAt}`);
      return;
    }
    if (!this.isWithinBusinessHours(cfg.id)) {
      const opensAt = this.nextBusinessWindowStart(cfg.id);
      await this.triggerQueue.scheduleIdleCheck(data, opensAt, `w${opensAt.getTime()}`);
      return;
    }
    await this.createAutoFollowup(cfg, lead, data.stage, rule);
  }

  // Job: toque de cadência vencido. Mesmas condições do findDueCadenceLeads, para UM lead.
  async runCadenceStep(data: CadenceStepJob): Promise<void> {
    const cfg = await this.configRepo.findOne({ where: { id: data.tenantId } });
    if (!cfg) return;
    const lead = await this.leadsService.findOne(data.leadId, data.tenantId);
    if (!lead?.nextNurtureAt || new Date(lead.nextNurtureAt).getTime() !== data.anchor) return; // lead respondeu
    if (lead.nurturePaused || !lead.phone) return; // resposta nova tira a pausa e reagenda
    const steps = this.cadenceStepsFor(cfg, lead.stage);
    if (!steps) return; // mudar pra raia com cadência reagenda
    // Lead falou por último: a resposta da IA (mensagem nossa) re-arma este mesmo job.
    if (lead.lastMessageDirection !== 'outbound') return;
    if (!(await this.leadsService.getAiEnabled(lead.id))) return;

    if (!this.isWithinBusinessHours(cfg.id)) {
      const opensAt = this.nextBusinessWindowStart(cfg.id);
      await this.triggerQueue.scheduleCadenceStep(data, opensAt, `w${opensAt.getTime()}`);
      return;
    }
    await this.fireCadenceStep(cfg, lead, steps);
  }

  // Job: lembrete de agendamento. Mesmas condições do findDueReminders, para UM agendamento.
  async runAppointmentReminder(data: AppointmentReminderJob): Promise<void> {
    const appt = await this.appointmentsService.findById(data.appointmentId);
    if (!appt?.tenantId || new Date(appt.startDateTime).getTime() !== data.startMs) return; // remarcado
    if (!['agendado', 'confirmado'].includes(appt.status) || appt.reminderSentAt || !appt.clientPhone) return;
    const cfg = await this.configRepo.findOne({ where: { id: appt.tenantId } });
    if (!cfg || cfg.archivedAt) return;
    const gate = resolveReminderGate(cfg.appointmentReminder);
    if (gate.skip) return;
    const msLeft = data.startMs - Date.now();
    if (msLeft < AppointmentsService.REMINDER_MIN_LEAD_MS) return;
    // Antecedência diminuiu depois do agendamento: o job da antecedência nova já existe.
    if (msLeft > gate.hoursBefore * 3600_000 + 60_000) return;
    if (!(await this.appointmentsService.claimReminder(appt.id))) return;
    await this.sendAppointmentReminder(cfg, appt);
  }

  // Varredura ÚNICA (subida do deploy / config salva): enfileira quem já estava esperando.
  // Os jobIds são determinísticos, então rodar de novo não duplica nada.
  private async backfillAll(): Promise<void> {
    const configs = await this.configRepo.find({ where: { archivedAt: IsNull() } });
    let total = 0;
    for (const cfg of configs) {
      try {
        total += await this.backfillTenant(cfg);
      } catch (err) {
        this.logger.error(`[FU-TRIGGER] Varredura falhou no tenant ${cfg.id}: ${err?.message ?? err}`);
      }
    }
    this.logger.log(`[FU-TRIGGER] Varredura da subida: ${total} job(s) agendado(s)`);
  }

  private async backfillTenant(cfgOrId: WhatsappConfig | string): Promise<number> {
    const cfg = typeof cfgOrId === 'string' ? await this.configRepo.findOne({ where: { id: cfgOrId } }) : cfgOrId;
    if (!cfg || cfg.archivedAt) return 0;
    let n = 0;

    for (const stage of AUTO_FOLLOWUP_STAGES) {
      const rule = this.autoRuleFor(cfg, stage);
      if (!rule?.activeSince) continue;
      for (const c of await this.leadsService.findAutoFollowupCandidates(cfg.id, stage, new Date(rule.activeSince))) {
        await this.scheduleIdleCheck(cfg, c, { id: c.messageId, direction: 'outbound', createdAt: c.messageAt });
        n++;
      }
    }

    if (Object.values(cfg.followupCadence ?? {}).some((steps) => !!steps?.length)) {
      for (const lead of await this.leadsService.findCadenceCandidates(cfg.id)) {
        if (!this.cadenceStepsFor(cfg, lead.stage)) continue;
        await this.scheduleCadenceIfArmed(cfg, lead);
        n++;
      }
    }

    if (!resolveReminderGate(cfg.appointmentReminder).skip) {
      for (const appt of await this.appointmentsService.findUpcomingForReminder(cfg.id)) {
        await this.scheduleReminder(cfg, appt);
        n++;
      }
    }
    return n;
  }

  // ── Helpers anti-bloqueio ──

  // Hora em Brasília (0–23) — agora, ou no instante `at`.
  private currentHourBRT(at: Date = new Date()): number {
    const h = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false,
    }).format(at);
    // '24' pode aparecer à meia-noite em alguns ambientes — normaliza para 0.
    const n = parseInt(h, 10);
    return n === 24 ? 0 : n;
  }

  // Dia da semana em Brasília (0=domingo ... 6=sábado, igual Date#getDay()).
  private currentWeekdayBRT(at: Date = new Date()): number {
    const short = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo', weekday: 'short',
    }).format(at);
    const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return map[short] ?? at.getDay();
  }

  // tenantId opcional: se o tenant tiver uma janela customizada (ver
  // TENANT_FOLLOWUP_WINDOW_OVERRIDES), usa ela — com janela própria pra sáb/dom —
  // em vez do padrão 9h-20h (todo santo dia) do resto do sistema.
  isWithinBusinessHours(tenantId?: string, at: Date = new Date()): boolean {
    const h = this.currentHourBRT(at);
    const override = tenantId ? TENANT_FOLLOWUP_WINDOW_OVERRIDES[tenantId] : undefined;
    if (!override) {
      return h >= BUSINESS_START_HOUR && h < BUSINESS_END_HOUR;
    }
    const dow = this.currentWeekdayBRT(at);
    const window = dow === 0 ? override.sunday : dow === 6 ? override.saturday : override.weekday;
    return h >= window.start && h < window.end;
  }

  // 00:00 de amanhã em Brasília (UTC-3 fixo, sem horário de verão desde 2019).
  startOfNextDayBRT(from: Date = new Date()): Date {
    const DAY = 24 * 3600_000;
    const OFFSET = 3 * 3600_000;
    return new Date(Math.floor((from.getTime() - OFFSET) / DAY) * DAY + DAY + OFFSET);
  }

  // Próximo instante dentro da janela de envio do tenant. As janelas abrem em hora cheia
  // e o fuso de Brasília é inteiro, então andar de 15 em 15 min cai exatamente na abertura.
  nextBusinessWindowStart(tenantId: string, from: Date = new Date()): Date {
    const STEP = 15 * 60_000;
    let t = Math.ceil(from.getTime() / STEP) * STEP;
    for (let i = 0; i < 8 * 24 * 4; i++, t += STEP) {
      if (this.isWithinBusinessHours(tenantId, new Date(t))) return new Date(t);
    }
    return new Date(from.getTime() + 60 * 60_000); // janela inválida: tenta de novo em 1h
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  // Variação de texto (spin): resolve grupos {opção A|opção B|opção C} escolhendo
  // uma alternativa aleatória. Deixa {nome}/{hora}/{data} intactos (não têm "|").
  // Ex: "{Oi|Olá|Ei} {nome}! {Vamos combinar?|Bora marcar?}" → "Olá João! Bora marcar?"
  // Objetivo anti-bloqueio: cada lead recebe uma redação diferente da mesma ideia,
  // evitando que o WhatsApp veja centenas de mensagens idênticas.
  private spin(text: string): string {
    if (!text) return text;
    const group = /\{([^{}]*\|[^{}]*)\}/; // só grupos que contêm "|"
    let out = text;
    let guard = 0;
    while (group.test(out) && guard < 50) {
      out = out.replace(group, (_m, inner: string) => {
        const opts = inner.split('|');
        return opts[Math.floor(Math.random() * opts.length)];
      });
      guard++;
    }
    // Limpa espaços duplos/vírgulas órfãs que sobram quando uma opção é vazia.
    return out.replace(/\s+([,.!?])/g, '$1').replace(/\s{2,}/g, ' ').trim();
  }

  // Quantos follow-ups já foram ENVIADOS hoje (dia BRT) por este tenant.
  async countSentTodayByTenant(tenantId: string): Promise<number> {
    const rows = await this.followupRepo.query(
      `SELECT COUNT(*)::int AS cnt
         FROM followups
        WHERE tenant_id = $1
          AND status = 'sent'
          AND sent_at IS NOT NULL
          AND (sent_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date
              = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date`,
      [tenantId],
    );
    return rows[0]?.cnt ?? 0;
  }

  async followupDailyLimit(tenantId: string): Promise<number> {
    const cfg = await this.configRepo.findOne({ where: { id: tenantId } });
    const limit = cfg?.followupLimitPerDay;
    return typeof limit === 'number' && limit > 0 ? limit : DEFAULT_FOLLOWUP_DAILY_LIMIT;
  }

  // Momento do último follow-up ENVIADO por este tenant (null se nunca enviou).
  // Base do espaçamento mínimo entre envios (PROTEÇÃO 4, anti-rajada).
  async lastSentAtByTenant(tenantId: string): Promise<Date | null> {
    const rows = await this.followupRepo.query(
      `SELECT MAX(sent_at) AS last FROM followups WHERE tenant_id = $1 AND status = 'sent'`,
      [tenantId],
    );
    const last = rows[0]?.last;
    return last ? new Date(last) : null;
  }

  // A cada 10 min: detecta leads ociosos por raia e agenda follow-up automático.
  // Não envia direto — cria linhas Followup (status pending) que o processDue() envia.
  // O claim atômico da raia garante "1x por raia, para sempre".
  @Cron('*/10 * * * *')
  async processAutoFollowups(): Promise<void> {
    if (this.queueMode) return; // modo fila: job de inatividade por lead (runIdleCheck)
    // Fora do horário comercial (9h–20h BRT) nem agenda — evita acumular backlog de madrugada.
    if (!this.isWithinBusinessHours()) return;

    const STAGES = ['novo_lead', 'lead_frio', 'lead_quente'] as const;
    // Cliente arquivado não dispara nada (follow-up automático, cadência, lembrete de consulta).
    const configs = await this.configRepo.find({ where: { archivedAt: IsNull() } });

    for (const cfg of configs) {
      if (cfg.autoFollowupEnabled === false) continue;

      const fu = cfg.autoFollowupConfig;
      if (!fu || typeof fu !== 'object') continue;

      for (const stage of STAGES) {
        const rule = fu[stage];
        if (!rule?.enabled || !rule.message?.trim() || !(rule.idleMinutes > 0) || !rule.activeSince) continue;

        try {
          const leads = await this.leadsService.findIdleLeadsForAutoFollowup(cfg.id, stage, rule.idleMinutes, new Date(rule.activeSince));
          for (const lead of leads) {
            await this.createAutoFollowup(cfg, lead, stage, rule);
          }
        } catch (err) {
          this.logger.error(`[AUTO-FOLLOWUP] Falha no tenant ${cfg.id} raia ${stage}: ${err?.message ?? err}`);
        }
      }
    }
  }

  // Claim atômico da raia + cria o follow-up pendente e põe na fila de envio. Usado pelo
  // cron legado e pelo job de inatividade (runIdleCheck).
  private async createAutoFollowup(cfg: WhatsappConfig, lead: Lead, stage: string, rule: AutoRule): Promise<void> {
    // Claim atômico: só agenda se ESTA execução marcou a raia.
    const claimed = await this.leadsService.claimAutoFollowupStage(lead.id, stage);
    if (!claimed) return;

    let message: string | null = null;
    if (AGENT_AWARE_FOLLOWUP_TENANT_IDS.includes(cfg.id) && cfg.multiAgentEnabled) {
      message = await this.buildAgentAwareFollowupMessage(cfg.id, lead);
    }
    if (!message) {
      message = this.interpolateName(rule.message, lead.name);
    }
    const savedAuto = await this.followupRepo.save(this.followupRepo.create({
      tenantId: cfg.id,
      leadId: lead.id,
      phone: lead.phone,
      message,
      scheduledAt: new Date(),
      status: 'pending',
    }));
    // Jitter espalha o lote criado neste tick (no modo fila os jobs correm em
    // paralelo; no legado o sleep entre envios do processDue fazia esse papel).
    await this.followupQueue.enqueue(savedAuto.id, savedAuto.scheduledAt, Math.floor(Math.random() * 8000));
    this.logger.log(`[AUTO-FOLLOWUP] Agendado [raia=${stage}] → ${lead.phone} (lead ${lead.id})`);
  }

  // Cadência de follow-up (múltiplos toques): reinicia o relógio de ociosidade
  // (nurture_step=0, next_nurture_at = agora + offset do 1º passo) toda vez que o
  // lead manda uma mensagem. Chamado pelo evolution.controller.ts logo após salvar
  // o inbound. Sem cadência configurada pra raia atual → apenas zera (idempotente).
  // ⚠️ steps[0].offsetMinutes é o gatilho de RESET — dispara de novo depois desse
  // tempo mesmo que o lead tenha acabado de responder normalmente numa conversa ativa.
  // NUNCA configure um valor curto aqui (ex.: 2min) — uma pausa comum de "lendo e
  // digitando" numa conversa de verdade passa disso fácil, e o follow-up cai por cima
  // da conversa ao vivo, fora de contexto (bug real em prod, 2026-07-23, tenant
  // claudia_teste). Mínimo recomendado: 20-30min mesmo em teste.
  // Qualquer resposta do lead também tira a pausa de follow-up (nurturePaused) —
  // se ele voltou a falar, o "pare"/"não tenho interesse" anterior não vale mais
  // pro ciclo novo (mas o STOP determinístico em evolution.controller.ts pode
  // reativar a pausa de novo na MESMA mensagem, se ela também contiver um pedido de parar).
  async resetCadenceOnReply(tenantId: string, lead: Lead): Promise<void> {
    try {
      const cfg = await this.configRepo.findOne({ where: { id: tenantId } });
      const steps = cfg?.followupCadence?.[lead.stage];
      if (!steps?.length) {
        if (lead.nurtureStep !== 0 || lead.nextNurtureAt || lead.nurturePaused) {
          await this.leadsService.update(lead.id, { nurtureStep: 0, nextNurtureAt: null, nurturePaused: false } as any, tenantId);
        }
        return;
      }
      const nextNurtureAt = new Date(Date.now() + steps[0].offsetMinutes * 60_000);
      await this.leadsService.update(lead.id, { nurtureStep: 0, nextNurtureAt, nurturePaused: false } as any, tenantId);
      // Sem await: isto roda antes da IA responder — Redis lento não pode atrasar a resposta.
      if (this.queueMode) this.armCadence(tenantId, lead.id, nextNurtureAt);
    } catch (err) {
      this.logger.error(`[CADENCE] Falha ao resetar p/ lead ${lead.id}: ${err?.message ?? err}`);
    }
  }

  // A cada minuto: dispara os toques de cadência vencidos (next_nurture_at <= agora).
  // Diferente do processAutoFollowups (1x por raia, pra sempre), aqui cada raia pode
  // ter VÁRIOS toques configurados (followupCadence) — o relógio reinicia a cada
  // resposta do lead (resetCadenceOnReply) e avança um passo por vez.
  // Não envia direto — cria linhas Followup (status pending) que o processDue() envia,
  // herdando automaticamente horário comercial / teto diário / espaçamento.
  @Cron(CronExpression.EVERY_MINUTE)
  async processCadenceFollowups(): Promise<void> {
    if (this.queueMode) return; // modo fila: job por toque (runCadenceStep)
    // Cliente arquivado não dispara nada (follow-up automático, cadência, lembrete de consulta).
    const configs = await this.configRepo.find({ where: { archivedAt: IsNull() } });

    for (const cfg of configs) {
      // Cada tenant pode ter uma janela diferente (ver TENANT_FOLLOWUP_WINDOW_OVERRIDES).
      if (!this.isWithinBusinessHours(cfg.id)) continue;

      const cadence = cfg.followupCadence;
      if (!cadence || typeof cadence !== 'object') continue;

      for (const stage of Object.keys(cadence) as LeadStage[]) {
        const steps = cadence[stage];
        if (!steps?.length) continue;

        try {
          const leads = await this.leadsService.findDueCadenceLeads(cfg.id, stage);
          for (const lead of leads) {
            await this.fireCadenceStep(cfg, lead, steps);
          }
        } catch (err) {
          this.logger.error(`[CADENCE] Falha no tenant ${cfg.id} raia ${stage}: ${err?.message ?? err}`);
        }
      }
    }
  }

  // Um toque de cadência: claim otimista no next_nurture_at, avança o passo, gera a
  // mensagem e põe na fila de envio. Usado pelo cron legado e pelo job (runCadenceStep).
  private async fireCadenceStep(
    cfg: WhatsappConfig,
    lead: Lead,
    steps: { offsetMinutes: number; angle: string; fallbackMessage?: string }[],
  ): Promise<void> {
    const step = steps[lead.nurtureStep];
    const expectedNextNurtureAt = lead.nextNurtureAt;

    // Sem passo neste índice → cadência esgotada, encerra (sem reivindicar).
    if (!step) {
      await this.leadsService.update(lead.id, { nextNurtureAt: null } as any, cfg.id);
      return;
    }

    // Claim atômico: só segue quem conseguiu mover o next_nurture_at desta execução.
    const claimed = await this.leadsService.claimCadenceStep(lead.id, expectedNextNurtureAt);
    if (!claimed) return;

    let message: string | null = null;
    if (AGENT_AWARE_FOLLOWUP_TENANT_IDS.includes(cfg.id) && cfg.multiAgentEnabled) {
      message = await this.buildAgentAwareFollowupMessage(cfg.id, lead, step.angle);
    }
    if (!message && step.fallbackMessage?.trim()) {
      message = this.interpolateName(step.fallbackMessage, lead.name);
    }

    const nextStep = steps[lead.nurtureStep + 1];
    const nextNurtureAt = nextStep ? new Date(Date.now() + nextStep.offsetMinutes * 60_000) : null;
    await this.leadsService.update(lead.id, { nurtureStep: lead.nurtureStep + 1, nextNurtureAt } as any, cfg.id);
    if (this.queueMode && nextNurtureAt) this.armCadence(cfg.id, lead.id, nextNurtureAt);

    if (!message) {
      this.logger.warn(`[CADENCE] Passo ${lead.nurtureStep} sem mensagem (agente falhou e sem fallbackMessage) — lead ${lead.id}, pulando envio`);
      return;
    }

    const savedCadence = await this.followupRepo.save(this.followupRepo.create({
      tenantId: cfg.id,
      leadId: lead.id,
      phone: lead.phone,
      message,
      scheduledAt: new Date(),
      status: 'pending',
    }));
    await this.followupQueue.enqueue(savedCadence.id, savedCadence.scheduledAt, Math.floor(Math.random() * 8000));
    this.logger.log(`[CADENCE] Toque ${lead.nurtureStep + 1}/${steps.length} [raia=${lead.stage}] → ${lead.phone} (lead ${lead.id})`);
  }

  // A cada 5 minutos: envia lembrete com a antecedência configurada pelo tenant
  // (appointmentReminder.hoursBefore, default 24h). Cadência de 5min — e não horária —
  // porque com antecedência curta (1h) um tick de hora em hora erraria o alvo por
  // quase uma hora inteira. reminder_sent_at impede o reenvio a cada tick.
  //
  // Sem `enabled` ou sem texto o tenant é pulado: mensagem vazia é o desligamento
  // explícito pedido pelo produto — o lead não recebe nada.
  @Cron('*/5 * * * *')
  async processAppointmentReminders(): Promise<void> {
    if (this.queueMode) return; // modo fila: job por agendamento (runAppointmentReminder)
    // Cliente arquivado não dispara nada (follow-up automático, cadência, lembrete de consulta).
    const configs = await this.configRepo.find({ where: { archivedAt: IsNull() } });

    for (const cfg of configs) {
      const gate = resolveReminderGate(cfg.appointmentReminder);
      if (gate.skip) continue;

      try {
        const appointments = await this.appointmentsService.findDueReminders(cfg.id, gate.hoursBefore);
        for (const appt of appointments) {
          // Claim atômico: marca reminder_sent_at antes de enviar para evitar duplo envio.
          await this.appointmentsService.markReminderSent(appt.id);
          await this.sendAppointmentReminder(cfg, appt);
        }
      } catch (err) {
        this.logger.error(`[REMINDER] Falha no tenant ${cfg.id}: ${err?.message ?? err}`);
      }
    }
  }

  // Envia o lembrete (reminder_sent_at já marcado por quem chamou) e grava na conversa.
  // Usado pelo cron legado e pelo job (runAppointmentReminder).
  private async sendAppointmentReminder(cfg: WhatsappConfig, appt: Appointment): Promise<void> {
    const reminder = cfg.appointmentReminder!;
    const hora = appt.startDateTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
    const data = appt.startDateTime.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
    const profissional = await this.appointmentsService.professionalNameFor(appt);
    const message = this.interpolateAppointment(reminder.message, appt.clientName, hora, data, appt.service, profissional);

    const token = await this.resolveTenantToken(cfg.id);
    if (!token) return;

    const baseUrl = this.config.get<string>('UAZAPI_BASE_URL') ?? '';
    await firstValueFrom(
      this.http.post(`${baseUrl}/send/text`, { number: appt.clientPhone, text: message }, { headers: { token } }),
    );
    this.logger.log(`[REMINDER] Enviado → ${appt.clientPhone} (appt ${appt.id}, ${data} ${hora})`);

    // Registra na conversa do lead (aparece no CRM e entra no histórico da IA). Falha aqui
    // não pode derrubar o loop: o lembrete já foi enviado e reminder_sent_at já está marcado.
    if (appt.leadId) {
      try {
        const conversation = await this.leadsService.getConversationWithMessages(appt.leadId, cfg.id);
        if (conversation?.id) {
          await this.leadsService.saveMessage(conversation.id, 'outbound', 'operator', message);
          const lead = await this.leadsService.findOne(appt.leadId, cfg.id);
          if (lead) this.leadsGateway.emitLeadUpdated(lead);
        }
      } catch (err) {
        this.logger.error(`[REMINDER] Enviado, mas falhou ao gravar na conversa (appt ${appt.id}): ${err?.message ?? err}`);
      }
    }
  }

  // Substitui {nome} pelo primeiro nome do lead. Sem nome: remove o placeholder
  // e limpa vírgula/espaços órfãos ("Oi {nome}, tudo bem" → "Oi tudo bem").
  private interpolateName(template: string, name: string | null): string {
    const nome = (name?.trim().split(/\s+/)[0]) || '';
    let msg = template.replace(/\{nome\}/gi, nome);
    if (!nome) {
      msg = msg.replace(/\s+([,.!?])/g, '$1').replace(/\s{2,}/g, ' ').replace(/^[\s,]+/, '').trim();
    }
    return msg;
  }

  private interpolateAppointment(template: string, clientName: string, hora: string, data: string, servico?: string | null, profissional?: string | null): string {
    const nome = (clientName?.trim().split(/\s+/)[0]) || '';
    const SERVICE_LABEL: Record<string, string> = { mega_hair: 'Mega Hair', manutencao: 'Manutenção' };
    let msg = template
      .replace(/\{nome\}/gi, nome)
      .replace(/\{hora\}/gi, hora)
      .replace(/\{data\}/gi, data)
      // {servico}/{profissional}: agenda com profissionais (agenda/). Vazio nos agendamentos antigos.
      .replace(/\{servico\}/gi, servico ? (SERVICE_LABEL[servico] ?? servico) : '')
      .replace(/\{profissional\}/gi, profissional ?? '');
    if (!nome) {
      msg = msg.replace(/\s+([,.!?])/g, '$1').replace(/\s{2,}/g, ' ').replace(/^[\s,]+/, '').trim();
    }
    return msg;
  }

  // ───────────────────────── Helpers ─────────────────────────

  async send(f: Followup): Promise<void> {
    const baseUrl = this.config.get<string>('UAZAPI_BASE_URL') ?? '';
    const token = await this.resolveTenantToken(f.tenantId);
    if (!token) throw new Error('Token da instância não encontrado');

    // Resolve a variação de texto no momento do envio: cada disparo vira uma
    // redação única, mesmo que vários leads compartilhem o mesmo template.
    const text = this.spin(f.message);

    await firstValueFrom(
      this.http.post(`${baseUrl}/send/text`, { number: f.phone, text }, { headers: { token } }),
    );

    // Registra na conversa + atualiza o lead no kanban em tempo real.
    const conversation = await this.leadsService.getConversationWithMessages(f.leadId, f.tenantId);
    if (conversation?.id) {
      await this.leadsService.saveMessage(conversation.id, 'outbound', 'operator', text);
    }
    await this.leadsService.update(f.leadId, { lastMessageAt: new Date() } as any, f.tenantId);
    const lead = await this.leadsService.findOne(f.leadId, f.tenantId);
    if (lead) this.leadsGateway.emitLeadUpdated(lead);
  }

  private async resolveTenantToken(tenantId: string): Promise<string> {
    const sc = await this.configRepo.findOne({ where: { id: tenantId } });
    if (sc?.instanceToken) return sc.instanceToken;
    return this.config.get<string>('UAZAPI_TOKEN') ?? '';
  }

  // Monta o follow-up "com conhecimento" (agente real + transcript). Retorna null
  // se não achar agente ou se a geração falhar — o chamador cai pro template fixo.
  // `angle`: instrução opcional do passo da cadência (ex.: "retoma a dor que ela
  // relatou"), pra cada toque ter um ângulo diferente em vez de repetir a mesma ideia.
  private async buildAgentAwareFollowupMessage(tenantId: string, lead: Lead, angle?: string): Promise<string | null> {
    try {
      const agent = (lead.currentAgentId
        ? await this.agentRepo.findOne({ where: { id: lead.currentAgentId, tenantId } })
        : null) ?? await this.agentRepo.findOne({ where: { tenantId, isDefault: true } });
      if (!agent) return null;

      const conversation = await this.leadsService.getConversationWithMessages(lead.id, tenantId);
      const aiLabel = agent.name?.split('—')[0]?.trim() || 'IA';
      const transcript = this.buildTranscript(conversation?.messages ?? [], aiLabel);
      const text = await this.aiService.generateAgentAwareFollowup(agent.systemPrompt, lead.name, transcript, angle);
      return text?.trim() || null;
    } catch (err) {
      this.logger.error(`[FOLLOWUP-AGENT-AWARE] Falha ao gerar p/ lead ${lead.id}: ${err?.message ?? err} — usando template fixo`);
      return null;
    }
  }

  // aiLabel: nome do agente/persona pra rotular as falas da IA na transcrição (uso
  // interno, nunca aparece pro cliente). Sem agente no contexto (fallback genérico
  // de generateSuggestion), usa 'IA' — nunca mais hardcoded pra um tenant específico.
  private buildTranscript(messages: Array<{ direction: string; sender: string; content: string }>, aiLabel = 'IA'): string {
    // Limita às últimas 30 mensagens p/ controlar tokens.
    const recent = messages.slice(-30);
    return recent
      .map((m) => {
        const who = m.direction === 'inbound' ? 'Cliente' : (m.sender === 'ai' ? aiLabel : 'Operador');
        return `${who}: ${m.content}`;
      })
      .join('\n');
  }
}
