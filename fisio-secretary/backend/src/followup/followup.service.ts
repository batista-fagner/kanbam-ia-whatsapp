import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { Followup } from '../common/entities/followup.entity';
import { WhatsappConfig } from '../common/entities/whatsapp-config.entity';
import { Agent } from '../common/entities/agent.entity';
import { Lead, LeadStage } from '../common/entities/lead.entity';
import { LeadsService } from '../leads/leads.service';
import { LeadsGateway } from '../leads/leads.gateway';
import { AiService } from '../ai/ai.service';
import { AppointmentsService } from '../appointments/appointments.service';

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

// Follow-up "com conhecimento": em vez do template fixo configurado na tela de
// alertas, gera a mensagem com IA usando o system_prompt real do agente que
// estava atendendo (voz + regras + base de conhecimento) + a conversa até onde
// parou. Só pra tenants de teste habilitados — nos demais, comportamento
// idêntico ao de sempre (template fixo + spin).
const AGENT_AWARE_FOLLOWUP_TENANT_IDS = ['1ff3f0b3-52d1-4e89-b7bf-552d0556de29']; // claudia_teste@hotmail.com

// Bypass TEMPORÁRIO da janela de horário comercial (9h-20h) — só pro tenant da demo
// de prospecção ativa (claudia_teste@hotmail.com), pedido pontual pra deixar a
// cadência testável a qualquer hora antes da apresentação do cliente dele
// (2026-07-24, ele testa às 10h). Remover quando o usuário pedir — não generalizar.
const BUSINESS_HOURS_BYPASS_TENANT_IDS = ['1ff3f0b3-52d1-4e89-b7bf-552d0556de29'];

@Injectable()
export class FollowupService {
  private readonly logger = new Logger(FollowupService.name);

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
  ) {}

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
    return { ok: true };
  }

  // ───────────────────────── Cron ─────────────────────────

  // A cada minuto: envia os follow-ups vencidos (scheduledAt <= agora).
  // Cada follow-up é "reivindicado" com um UPDATE atômico (pending → sending).
  // Só a instância que conseguir afetar a linha envia — evita duplicação em
  // múltiplas instâncias sem depender de Redis.
  @Cron(CronExpression.EVERY_MINUTE)
  async processDue(): Promise<void> {
    // PROTEÇÃO 1 — Janela de horário: fora de 9h–20h (BRT) não envia nada, EXCETO
    // pros tenants em BUSINESS_HOURS_BYPASS_TENANT_IDS (checado por follow-up, não
    // aqui — não pode ser um return global, senão bloqueia o bypass também).
    // Os follow-ups vencidos ficam pending e saem quando a janela abrir.
    const withinHours = this.isWithinBusinessHours();
    if (!withinHours && BUSINESS_HOURS_BYPASS_TENANT_IDS.length === 0) return;

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

      if (!withinHours && !BUSINESS_HOURS_BYPASS_TENANT_IDS.includes(f.tenantId)) {
        continue; // fora do horário e tenant não tem bypass — deixa pending
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

  // ── Helpers anti-bloqueio ──

  // Hora atual em Brasília (0–23).
  private currentHourBRT(): number {
    const h = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false,
    }).format(new Date());
    // '24' pode aparecer à meia-noite em alguns ambientes — normaliza para 0.
    const n = parseInt(h, 10);
    return n === 24 ? 0 : n;
  }

  private isWithinBusinessHours(): boolean {
    const h = this.currentHourBRT();
    return h >= BUSINESS_START_HOUR && h < BUSINESS_END_HOUR;
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
  private async countSentTodayByTenant(tenantId: string): Promise<number> {
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

  private async followupDailyLimit(tenantId: string): Promise<number> {
    const cfg = await this.configRepo.findOne({ where: { id: tenantId } });
    const limit = cfg?.followupLimitPerDay;
    return typeof limit === 'number' && limit > 0 ? limit : DEFAULT_FOLLOWUP_DAILY_LIMIT;
  }

  // Momento do último follow-up ENVIADO por este tenant (null se nunca enviou).
  // Base do espaçamento mínimo entre envios (PROTEÇÃO 4, anti-rajada).
  private async lastSentAtByTenant(tenantId: string): Promise<Date | null> {
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
    // Fora do horário comercial (9h–20h BRT) nem agenda — evita acumular backlog de madrugada.
    if (!this.isWithinBusinessHours()) return;

    const STAGES = ['novo_lead', 'lead_frio', 'lead_quente'] as const;
    const configs = await this.configRepo.find();

    for (const cfg of configs) {
      const fu = cfg.autoFollowupConfig;
      if (!fu || typeof fu !== 'object') continue;

      for (const stage of STAGES) {
        const rule = fu[stage];
        if (!rule?.enabled || !rule.message?.trim() || !(rule.idleMinutes > 0)) continue;

        try {
          const leads = await this.leadsService.findIdleLeadsForAutoFollowup(cfg.id, stage, rule.idleMinutes);
          for (const lead of leads) {
            // Claim atômico: só agenda se ESTA execução marcou a raia.
            const claimed = await this.leadsService.claimAutoFollowupStage(lead.id, stage);
            if (!claimed) continue;

            let message: string | null = null;
            if (AGENT_AWARE_FOLLOWUP_TENANT_IDS.includes(cfg.id) && cfg.multiAgentEnabled) {
              message = await this.buildAgentAwareFollowupMessage(cfg.id, lead);
            }
            if (!message) {
              message = this.interpolateName(rule.message, lead.name);
            }
            await this.followupRepo.save(this.followupRepo.create({
              tenantId: cfg.id,
              leadId: lead.id,
              phone: lead.phone,
              message,
              scheduledAt: new Date(),
              status: 'pending',
            }));
            this.logger.log(`[AUTO-FOLLOWUP] Agendado [raia=${stage}] → ${lead.phone} (lead ${lead.id})`);
          }
        } catch (err) {
          this.logger.error(`[AUTO-FOLLOWUP] Falha no tenant ${cfg.id} raia ${stage}: ${err?.message ?? err}`);
        }
      }
    }
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
  async resetCadenceOnReply(tenantId: string, lead: Lead): Promise<void> {
    try {
      const cfg = await this.configRepo.findOne({ where: { id: tenantId } });
      const steps = cfg?.followupCadence?.[lead.stage];
      if (!steps?.length) {
        if (lead.nurtureStep !== 0 || lead.nextNurtureAt) {
          await this.leadsService.update(lead.id, { nurtureStep: 0, nextNurtureAt: null } as any, tenantId);
        }
        return;
      }
      const nextNurtureAt = new Date(Date.now() + steps[0].offsetMinutes * 60_000);
      await this.leadsService.update(lead.id, { nurtureStep: 0, nextNurtureAt } as any, tenantId);
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
    const withinHours = this.isWithinBusinessHours();

    const configs = await this.configRepo.find();

    for (const cfg of configs) {
      // Fora do horário: só segue pros tenants com bypass (ver BUSINESS_HOURS_BYPASS_TENANT_IDS).
      if (!withinHours && !BUSINESS_HOURS_BYPASS_TENANT_IDS.includes(cfg.id)) continue;

      const cadence = cfg.followupCadence;
      if (!cadence || typeof cadence !== 'object') continue;

      for (const stage of Object.keys(cadence) as LeadStage[]) {
        const steps = cadence[stage];
        if (!steps?.length) continue;

        try {
          const leads = await this.leadsService.findDueCadenceLeads(cfg.id, stage);
          for (const lead of leads) {
            const step = steps[lead.nurtureStep];
            const expectedNextNurtureAt = lead.nextNurtureAt;

            // Sem passo neste índice → cadência esgotada, encerra (sem reivindicar).
            if (!step) {
              await this.leadsService.update(lead.id, { nextNurtureAt: null } as any, cfg.id);
              continue;
            }

            // Claim atômico: só segue quem conseguiu mover o next_nurture_at desta execução.
            const claimed = await this.leadsService.claimCadenceStep(lead.id, expectedNextNurtureAt);
            if (!claimed) continue;

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

            if (!message) {
              this.logger.warn(`[CADENCE] Passo ${lead.nurtureStep} sem mensagem (agente falhou e sem fallbackMessage) — lead ${lead.id}, pulando envio`);
              continue;
            }

            await this.followupRepo.save(this.followupRepo.create({
              tenantId: cfg.id,
              leadId: lead.id,
              phone: lead.phone,
              message,
              scheduledAt: new Date(),
              status: 'pending',
            }));
            this.logger.log(`[CADENCE] Toque ${lead.nurtureStep + 1}/${steps.length} [raia=${stage}] → ${lead.phone} (lead ${lead.id})`);
          }
        } catch (err) {
          this.logger.error(`[CADENCE] Falha no tenant ${cfg.id} raia ${stage}: ${err?.message ?? err}`);
        }
      }
    }
  }

  // A cada hora: envia lembrete ~24h antes do agendamento (janela 22h–26h).
  // reminder_sent_at impede reenvio mesmo que o cron rode múltiplas vezes na janela.
  @Cron('0 * * * *')
  async processAppointmentReminders(): Promise<void> {
    const configs = await this.configRepo.find();

    for (const cfg of configs) {
      const reminder = cfg.appointmentReminder;
      if (!reminder?.enabled || !reminder.message?.trim()) continue;

      try {
        const appointments = await this.appointmentsService.findDueReminders(cfg.id);
        for (const appt of appointments) {
          // Claim atômico: marca reminder_sent_at antes de enviar para evitar duplo envio.
          await this.appointmentsService.markReminderSent(appt.id);

          const hora = appt.startDateTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
          const data = appt.startDateTime.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
          const message = this.interpolateAppointment(reminder.message, appt.clientName, hora, data);

          const token = await this.resolveTenantToken(cfg.id);
          if (!token) continue;

          const baseUrl = this.config.get<string>('UAZAPI_BASE_URL') ?? '';
          await firstValueFrom(
            this.http.post(`${baseUrl}/send/text`, { number: appt.clientPhone, text: message }, { headers: { token } }),
          );
          this.logger.log(`[REMINDER] Enviado → ${appt.clientPhone} (appt ${appt.id}, ${data} ${hora})`);
        }
      } catch (err) {
        this.logger.error(`[REMINDER] Falha no tenant ${cfg.id}: ${err?.message ?? err}`);
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

  private interpolateAppointment(template: string, clientName: string, hora: string, data: string): string {
    const nome = (clientName?.trim().split(/\s+/)[0]) || '';
    let msg = template
      .replace(/\{nome\}/gi, nome)
      .replace(/\{hora\}/gi, hora)
      .replace(/\{data\}/gi, data);
    if (!nome) {
      msg = msg.replace(/\s+([,.!?])/g, '$1').replace(/\s{2,}/g, ' ').replace(/^[\s,]+/, '').trim();
    }
    return msg;
  }

  // ───────────────────────── Helpers ─────────────────────────

  private async send(f: Followup): Promise<void> {
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
