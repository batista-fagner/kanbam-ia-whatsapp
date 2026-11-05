import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Lead, LeadAgendaState } from '../../common/entities/lead.entity';
import { AgendaServiceEntity } from '../../common/entities/agenda-service.entity';
import type { Appointment } from '../../common/entities/appointment.entity';
import type { AiResponse } from '../../ai/ai.service';
import { formatInTZ, weekdayOfDateStr } from '../../common/utils/sp-time.util';
import { AgendaConflictError } from '../agenda.service';
import { SalonAlertNotifier } from '../agenda-notifier';
import { AGENDA_JSON_FIELDS, AgendaPromptParts, ddmm, formatDuration, MAX_SLOTS_PER_DAY, normalizeDate, parseLocal, STATE_TTL_MS } from '../agenda-ai.shared';
import { TrinksAgendaBackend } from './trinks-agenda.backend';
import { TrinksIntegrationService } from './trinks-integration.service';

// Fluxo da IA quando a agenda do salão é a da Trinks. Mesmo contrato JSON da agenda do CRM
// (check_availability → 2ª chamada com HORÁRIOS LIVRES → schedule/reschedule/cancel), com travas
// extras pedidas pelo Fagner pra IA não errar:
// - só agenda serviço com ligação APROVADA pela cliente;
// - antes de gravar/remarcar/cancelar, o SISTEMA manda um resumo (dia da semana e data calculados
//   aqui, não pela IA) e só executa depois do "sim" da cliente;
// - nunca diz "agendado" sem o id da Trinks; qualquer falha vira "a equipe confirma" + aviso ao salão.

const WEEKDAY_LONG = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const WEEKDAY_WORDS: [RegExp, number][] = [
  [/\bdomingo\b/i, 0], [/\bsegunda\b/i, 1], [/\bter[çc]a\b/i, 2], [/\bquarta\b/i, 3], [/\bquinta\b/i, 4], [/\bsexta\b/i, 5], [/\bs[áa]bado\b/i, 6],
];
const ALERT_THROTTLE_MS = 30 * 60 * 1000;

function hhmm(d: Date): string {
  const c = formatInTZ(d);
  return `${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}`;
}

// "sexta-feira, 07/11 às 13:00" — calculado pelo sistema.
export function describeWhen(d: Date): string {
  const c = formatInTZ(d);
  return `${WEEKDAY_LONG[weekdayOfDateStr(c.date)]}, ${ddmm(c.date)} às ${hhmm(d)}`;
}

// A resposta da IA fala do mesmo dia/horário que o sistema vai gravar? Qualquer data, dia da
// semana ou horário diferente → false (o texto da IA é descartado e vale o do sistema).
export function replyMatchesWhen(reply: string, start: Date): { consistent: boolean; mentionsTime: boolean } {
  const c = formatInTZ(start);
  const wantTime = hhmm(start);
  const wantDate = ddmm(c.date);
  const wantWeekday = weekdayOfDateStr(c.date);
  const text = reply ?? '';
  const times = [...text.matchAll(/\b([01]?\d|2[0-3])(?::([0-5]\d)|h([0-5]\d)?)(?![\d/])/gi)].map((m) => `${m[1].padStart(2, '0')}:${m[2] ?? m[3] ?? '00'}`);
  const dates = [...text.matchAll(/\b(\d{1,2})\/(\d{1,2})\b/g)].map((m) => `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}`);
  const weekdays = WEEKDAY_WORDS.filter(([re]) => re.test(text)).map(([, n]) => n);
  const consistent = times.every((t) => t === wantTime) && dates.every((d) => d === wantDate) && weekdays.every((w) => w === wantWeekday);
  return { consistent, mentionsTime: times.length > 0 };
}

// A IA "disse que fez"? (agendado/agendei, marcado/marquei, cancelado/cancelei…)
export function claimsDone(reply: string): boolean {
  return /\b(agendad[oa]s?|agendei|marcad[oa]s?|marquei|remarcad[oa]s?|remarquei|cancelad[oa]s?|cancelei|confirmad[oa]s?|confirmei|reservad[oa]s?|reservei)\b/i.test(reply ?? '');
}

export function buildTrinksAgendaRules(services: AgendaServiceEntity[]): { rules: string; codes: Record<string, string> } {
  const codes: Record<string, string> = {};
  const lines = services.map((s, i) => {
    const code = `S${i + 1}`;
    codes[code] = s.id;
    return `- ${code} — ${s.name} — ${formatDuration(s.durationMinutes)}`;
  });
  const rules = `════════ AGENDA DO SALÃO (agenda da Trinks — você marca direto nela) ════════
SERVIÇOS QUE PODEM SER AGENDADOS (código — nome — duração):
${lines.length ? lines.join('\n') : '- (nenhum serviço liberado para agendamento — não agende; diga que a equipe confirma o horário)'}
Serviço que NÃO está nesta lista você não agenda: diga que a equipe vai confirmar o horário com ela.
PREÇOS: use SEMPRE a tabela de preços deste prompt. Esta lista da agenda não tem preço.

COMO AGENDAR (um passo por mensagem):
1. Descubra QUAL serviço ela quer (escolha o código certo pela lista; se ficar em dúvida entre dois, pergunte) e QUAL DIA ela prefere.
2. Com serviço + dia definidos e SEM a lista HORÁRIOS LIVRES desse serviço no final do prompt: action="check_availability", agendaServiceCode e agendaDate. O sistema consulta a agenda e te devolve a lista.
   Se a lista HORÁRIOS LIVRES desse serviço JÁ ESTÁ no final do prompt, NÃO use check_availability de novo — use a lista. Só consulte de novo se ela mudar de serviço ou pedir um dia que não aparece na lista.
3. Com a lista HORÁRIOS LIVRES: ofereça até 3 horários do dia que ela pediu (os primeiros). Se esse dia não tiver vaga, diga isso e ofereça o dia mais próximo que aparece na lista. action="none".
4. Quando ela escolher um horário QUE ESTÁ NA LISTA: action="schedule", agendaServiceCode e appointmentDateTime exatamente como na lista. O SISTEMA coloca logo abaixo do seu reply um resumo pedindo a confirmação — no reply NÃO diga que está agendado e não fale em "sistema" ou "resumo"; só informe condições (ex.: sinal), se houver, ou deixe o reply curto.
5. Quando aparecer AGUARDANDO CONFIRMAÇÃO no fim do prompt e ela confirmar (sim, pode, ok, confirmo…): action="schedule" de novo com os MESMOS dados e stage="agendado". Só aí fica agendado.
REMARCAR: se ela já tem um agendamento (ver AGENDAMENTO ATUAL DA CLIENTE) e quer outro dia ou horário: consulte o novo dia (check_availability, mesmo serviço), ofereça os horários e, quando ela escolher, action="reschedule" com o novo appointmentDateTime. O sistema pede confirmação; quando ela confirmar, action="reschedule" de novo com os mesmos dados.
CANCELAR: se ela pedir para cancelar: action="cancel". O sistema pergunta se ela tem certeza; quando ela confirmar, action="cancel" de novo.

PROIBIDO:
- Oferecer ou agendar horário que não está na lista HORÁRIOS LIVRES. Nunca invente, arredonde ou calcule horário.
- Dizer que está agendado/remarcado/cancelado antes da confirmação do sistema (passo 5) ou sem usar a action.
- Falar de profissional ou deixar a cliente escolher profissional — o salão define quem atende.`;
  return { rules, codes };
}

@Injectable()
export class TrinksAiFlow {
  private readonly logger = new Logger('TrinksAiFlow');
  private readonly lastAlert = new Map<string, number>();

  constructor(
    private readonly backend: TrinksAgendaBackend,
    private readonly integration: TrinksIntegrationService,
    private readonly salon: SalonAlertNotifier,
    @InjectRepository(Lead) private readonly leadRepo: Repository<Lead>,
  ) {}

  // undefined = cliente não usa a Trinks (segue o fluxo da agenda do CRM).
  // null = usa a Trinks mas "A IA pode agendar sozinha" está desligado (fluxo antigo, sem agenda).
  async prepare(tenantId: string, lead: Lead, justChecked = false): Promise<AgendaPromptParts | null | undefined> {
    const schedule = await this.backend.schedule(tenantId);
    if (schedule?.mode !== 'trinks') return undefined;
    if (!schedule.enabled) return null;
    // Sem conexão/serviço aprovado as regras dizem "não agende" — e o fluxo antigo (09:00 fixo)
    // continua desligado, porque devolvemos partes mesmo assim.
    const services = await this.integration.approvedServices(tenantId).catch(() => [] as AgendaServiceEntity[]);
    const { rules, codes } = buildTrinksAgendaRules(services);
    const dynamic = await this.buildDynamic(tenantId, lead, services, codes, justChecked);
    return { rules, jsonFields: AGENDA_JSON_FIELDS, dynamic, codes, backend: 'trinks' };
  }

  private async buildDynamic(tenantId: string, lead: Lead, services: AgendaServiceEntity[], codes: Record<string, string>, justChecked: boolean): Promise<string> {
    const codeOf = (id: string | null | undefined) => (id ? Object.keys(codes).find((c) => codes[c] === id) : undefined);
    const nameOf = (id: string | null | undefined) => services.find((s) => s.id === id)?.name;
    const parts: string[] = ['════════ AGENDA AGORA (agenda da Trinks) ════════'];

    // Cópia local — não gasta cota da Trinks a cada mensagem.
    const current = await this.backend.currentMirror(tenantId, lead.id).catch(() => null);
    parts.push(current
      ? `AGENDAMENTO ATUAL DA CLIENTE: ${codeOf(current.serviceId) ? `${codeOf(current.serviceId)} ` : ''}${current.service} — ${describeWhen(current.startDateTime)}`
      : 'AGENDAMENTO ATUAL DA CLIENTE: nenhum registrado pela IA (se ela disser que já tem horário marcado e quiser remarcar/cancelar, use a action — o sistema confere na agenda)');

    const state = lead.agendaState;
    const fresh = !!state && Date.now() - new Date(state.checkedAt).getTime() < STATE_TTL_MS;
    const pending = fresh && state!.pending && Date.now() - new Date(state!.pending.createdAt).getTime() < STATE_TTL_MS ? state!.pending : null;
    if (pending) {
      const code = codeOf(pending.serviceId);
      if (pending.kind === 'cancel') {
        parts.push('AGUARDANDO CONFIRMAÇÃO DA CLIENTE: o sistema perguntou se ela quer mesmo CANCELAR o agendamento atual. Se ela confirmou: action="cancel". Se desistiu de cancelar: action="none" e siga a conversa.');
      } else if (pending.start) {
        const when = describeWhen(new Date(pending.start));
        const local = formatInTZ(new Date(pending.start));
        const dt = `${local.date}T${hhmm(new Date(pending.start))}:00`;
        parts.push(`AGUARDANDO CONFIRMAÇÃO DA CLIENTE: o sistema mandou o resumo "${nameOf(pending.serviceId) ?? 'serviço'} — ${when}" (${pending.kind === 'reschedule' ? 'remarcação' : 'novo agendamento'}). Se ela confirmou: action="${pending.kind}", agendaServiceCode="${code ?? ''}", appointmentDateTime="${dt}", stage="agendado". Se ela quer outro horário/serviço, siga o fluxo normal. NUNCA diga que está agendado sem essa action.`);
      }
    }

    const svc = fresh ? services.find((s) => s.id === state!.serviceId) : undefined;
    if (svc && state!.unavailable) {
      parts.push('AGENDA INDISPONÍVEL AGORA: a consulta à agenda falhou. Diga com carinho que a equipe vai confirmar o horário com ela em seguida. Não ofereça horário e não use schedule.');
    } else if (svc && state!.days) {
      const days = state!.days;
      const requested = days.find((d) => d.date === state!.date);
      const others = days.filter((d) => d.date !== state!.date && d.times.length);
      const shown = [requested, ...others].filter(Boolean).slice(0, 3) as NonNullable<LeadAgendaState['days']>;
      const lines = shown.map((d) => `- ${d.weekday} ${ddmm(d.date)} (${d.date}): ${d.times.length ? d.times.slice(0, MAX_SLOTS_PER_DAY).join(', ') : 'SEM VAGA'}`);
      parts.push(`HORÁRIOS LIVRES — ${codeOf(svc.id)} ${svc.name} (${formatDuration(svc.durationMinutes)}) — consulta JÁ FEITA, use esta lista (não chame check_availability de novo pra este serviço): se ela ainda não escolheu, ofereça horários daqui; se escolheu um daqui, action="schedule":`);
      parts.push(lines.length ? lines.join('\n') : '- nenhum horário livre nos próximos dias — diga que a equipe vai confirmar um horário');
      if (justChecked) {
        parts.push('⚠️ ESTA É A CONSULTA QUE VOCÊ ACABOU DE PEDIR. Agora responda à cliente usando esta lista (action="none" para oferecer; "schedule"/"reschedule" se ela já disse um horário que está aqui). É PROIBIDO responder check_availability nesta mensagem.');
      }
    } else {
      parts.push('HORÁRIOS LIVRES: ainda não consultados — quando souber serviço + dia, use action="check_availability".');
    }
    return parts.join('\n');
  }

  private async saveState(lead: Lead, state: LeadAgendaState | null): Promise<void> {
    await this.leadRepo.update(lead.id, { agendaState: state } as any);
    lead.agendaState = state;
  }

  // action=check_availability → consulta a Trinks AGORA e guarda o resultado na conversa (os turnos
  // seguintes reaproveitam sem gastar cota; na hora de gravar o horário é conferido de novo).
  async registerCheck(tenantId: string, lead: Lead, ai: AiResponse, parts: AgendaPromptParts): Promise<boolean> {
    const serviceId = parts.codes[(ai.agendaServiceCode ?? '').trim().toUpperCase()];
    if (!serviceId) return false;
    const services = await this.integration.approvedServices(tenantId);
    const svc = services.find((s) => s.id === serviceId);
    if (!svc) return false;
    const today = formatInTZ(new Date()).date;
    const asked = normalizeDate(ai.agendaDate) ?? normalizeDate(ai.appointmentDateTime?.slice(0, 10));
    const date = asked && asked >= today ? asked : today;
    let days: LeadAgendaState['days'] = [];
    let unavailable = false;
    try {
      days = (await this.backend.fetchDays(tenantId, svc, date)).map((d) => ({ date: d.date, weekday: d.weekday, times: d.slots.map((s) => s.time) }));
    } catch (err) {
      unavailable = true;
      await this.integration.recordError(tenantId, err);
      this.alertSalon(tenantId, 'consulta', `⚠️ *Agenda Trinks*: não consegui consultar os horários agora (${(err as Error)?.message ?? err}).\n👤 ${lead.name || lead.phone} (${lead.phone}) quer *${svc.name}* — a IA avisou que a equipe confirma o horário.`);
    }
    await this.saveState(lead, { serviceId, date, checkedAt: new Date().toISOString(), days, unavailable, pending: null });
    this.logger.log(`[TRINKS-IA] Consulta ${ai.agendaServiceCode} em ${date}${unavailable ? ' (FALHOU)' : ''} (lead ${lead.id})`);
    return true;
  }

  async fallbackReply(lead: Lead): Promise<string> {
    const state = lead.agendaState;
    if (!state || state.unavailable) return 'Vou pedir pra equipe te confirmar o horário certinho, tá? 😊';
    const days = state.days ?? [];
    const day = days.find((d) => d.date === state.date && d.times.length) ?? days.find((d) => d.times.length);
    if (!day) return 'Não encontrei horário livre nos próximos dias 😕 Vou pedir pra equipe te confirmar um horário, tá?';
    const prefix = day.date === state.date ? `No dia ${ddmm(day.date)}` : `Nesse dia não tenho vaga 😕 No dia ${ddmm(day.date)}`;
    return `${prefix} tenho livre: ${day.times.slice(0, MAX_SLOTS_PER_DAY).join(', ')}. Qual fica melhor pra você?`;
  }

  // ───────── Ações ─────────

  async applyAction(tenantId: string, lead: Lead, ai: AiResponse, parts: AgendaPromptParts): Promise<void> {
    const action = ai.action as string;
    const state = lead.agendaState ?? null;
    const pending = state?.pending && Date.now() - new Date(state.pending.createdAt).getTime() < STATE_TTL_MS ? state.pending : null;

    if (!['schedule', 'reschedule', 'cancel'].includes(action)) {
      // A IA disse "agendado" sem a action enquanto o resumo espera o "sim": não deixa passar.
      if (pending && claimsDone(ai.reply)) {
        const services = await this.integration.approvedServices(tenantId).catch(() => [] as AgendaServiceEntity[]);
        ai.reply = pending.kind === 'cancel'
          ? 'Só pra eu ter certeza: você quer mesmo cancelar o seu agendamento? Me responde *sim* que eu cancelo 😊'
          : `Só pra eu confirmar certinho: *${services.find((s) => s.id === pending.serviceId)?.name ?? 'o serviço'}* na *${describeWhen(new Date(pending.start!))}*. Posso confirmar o agendamento?`;
        if (ai.stage === 'agendado') ai.stage = 'lead_quente';
        this.logger.warn(`[TRINKS-IA] IA disse que fez sem a action — resumo reenviado (lead ${lead.id})`);
      }
      return;
    }

    let summary = '';
    try {
      if (action === 'cancel') return await this.runCancel(tenantId, lead, ai, pending);
      const start = parseLocal(ai.appointmentDateTime);
      if (!start) {
        ai.reply = 'Me confirma o dia e o horário que você prefere, por favor?';
        return this.downgrade(ai);
      }
      const services = await this.integration.approvedServices(tenantId);
      const current = action === 'reschedule' ? await this.backend.resolveActive(tenantId, lead) : null;
      const code = (ai.agendaServiceCode ?? '').trim().toUpperCase();
      const serviceId = parts.codes[code] ?? (action === 'reschedule' ? current?.serviceId : null) ?? pending?.serviceId ?? state?.serviceId ?? null;
      const svc = services.find((s) => s.id === serviceId) ?? null;
      const kind: 'schedule' | 'reschedule' = action === 'reschedule' && current ? 'reschedule' : 'schedule';
      if (!svc) {
        if (kind === 'reschedule') {
          // Agendamento feito pela recepção com serviço que não está liberado pra IA.
          ai.reply = 'Vou pedir pra equipe remarcar pra você certinho, tá? Já já te chamam 😊';
          this.alertSalon(tenantId, `remarcar-${lead.id}`, `🔁 *Agenda Trinks — remarcação pela equipe*\n👤 ${lead.name || lead.phone} (${lead.phone}) quer remarcar *${current!.service}* (${describeWhen(current!.startDateTime)}) para *${describeWhen(start)}*. O serviço não está liberado para a IA — remarque pela Trinks.`);
          return this.downgrade(ai);
        }
        ai.reply = 'Qual serviço você quer agendar?';
        return this.downgrade(ai);
      }
      summary = `${svc.name} — ${describeWhen(start)}`;

      const confirmed = !!pending
        && pending.kind === kind
        && pending.serviceId === svc.id
        && pending.start === start.toISOString()
        && (kind !== 'reschedule' || pending.appointmentId === current!.id);

      if (!confirmed) {
        // 1º pedido: confere a vaga (lista da consulta ou, se não estiver nela, a Trinks ao vivo)
        // e manda o resumo. Nada é gravado ainda.
        await this.ensureSlotListed(tenantId, lead, svc, start);
        await this.saveState(lead, {
          ...(state ?? { serviceId: svc.id, date: formatInTZ(start).date, checkedAt: new Date().toISOString() }),
          pending: { kind, serviceId: svc.id, start: start.toISOString(), appointmentId: current?.id ?? null, createdAt: new Date().toISOString() },
        });
        const ask = kind === 'reschedule'
          ? `Só confirmando: vou mudar seu horário de *${svc.name}* de ${describeWhen(current!.startDateTime)} para *${describeWhen(start)}*. Posso confirmar?`
          : `Só confirmando: *${svc.name}* na *${describeWhen(start)}*. Posso confirmar o agendamento? 😊`;
        const check = replyMatchesWhen(ai.reply, start);
        const keep = ai.reply?.trim() && !claimsDone(ai.reply) && !/\b(sistema|resumo)\b/i.test(ai.reply) && check.consistent ? ai.reply.trim() : '';
        ai.reply = keep ? `${keep}\n\n${ask}` : ask;
        this.logger.log(`[TRINKS-IA] Resumo enviado (${kind}) ${summary} (lead ${lead.id})`);
        return this.downgrade(ai);
      }

      // Confirmado pela cliente → grava na Trinks.
      const appt: Appointment = kind === 'reschedule'
        ? await this.backend.reschedule(tenantId, current!, start, svc)
        : await this.backend.book({ tenantId, service: svc, start, lead, clientName: ai.fields?.name || lead.name || lead.phone });
      await this.leadRepo.update(lead.id, { appointmentAt: appt.startDateTime } as any);
      if (lead.agendaState) await this.saveState(lead, { ...lead.agendaState, pending: null });
      const line = kind === 'reschedule'
        ? `Prontinho, remarcado! ✅ *${svc.name}* — *${describeWhen(appt.startDateTime)}*.`
        : `Prontinho, agendado! ✅ *${svc.name}* — *${describeWhen(appt.startDateTime)}*.`;
      const check = replyMatchesWhen(ai.reply, appt.startDateTime);
      ai.reply = !ai.reply?.trim() || !check.consistent ? line : check.mentionsTime ? ai.reply.trim() : `${line}\n\n${ai.reply.trim()}`;
      ai.stage = 'agendado';
      this.logger.log(`[TRINKS-IA] ${kind === 'reschedule' ? 'Remarcado' : 'Agendado'} ${summary} — appt ${appt.id} (lead ${lead.id})`);
    } catch (err) {
      const cur = lead.agendaState;
      if (cur?.pending) await this.saveState(lead, { ...cur, pending: null }).catch(() => undefined);
      if (err instanceof AgendaConflictError) {
        const alt = err.alternatives;
        ai.reply = alt.length
          ? `Esse horário acabou de ser preenchido 😕 Tenho livre: ${alt.map((a) => `${ddmm(a.date)} às ${a.time}`).join(', ')}. Qual fica melhor pra você?`
          : 'Esse horário acabou de ser preenchido 😕 Vou pedir pra equipe te confirmar outro horário, tá?';
      } else {
        this.logger.error(`[TRINKS-IA] Falha em ${action} (lead ${lead.id}): ${(err as Error)?.message}`);
        await this.integration.recordError(tenantId, err);
        ai.reply = action === 'cancel'
          ? 'Tive um probleminha pra cancelar aqui 😕 Vou pedir pra equipe resolver pra você, tá?'
          : 'Tive um probleminha pra marcar aqui 😕 Vou pedir pra equipe confirmar seu horário certinho, tá?';
        this.alertSalon(tenantId, `falha-${lead.id}`, `⚠️ *Agenda Trinks — a IA não conseguiu ${action === 'cancel' ? 'cancelar' : action === 'reschedule' ? 'remarcar' : 'agendar'}*\n👤 ${lead.name || lead.phone} (${lead.phone})${summary ? `\n💇 ${summary}` : ''}\nMotivo: ${(err as Error)?.message ?? err}\nConfira e resolva pela Trinks.`);
      }
      this.downgrade(ai);
    }
  }

  private async runCancel(tenantId: string, lead: Lead, ai: AiResponse, pending: LeadAgendaState['pending'] | null): Promise<void> {
    const current = await this.backend.resolveActive(tenantId, lead);
    const state = lead.agendaState;
    if (!current) {
      ai.reply = 'Não encontrei nenhum agendamento ativo no seu nome por aqui 🤔 Quer marcar um horário?';
      if (state?.pending) await this.saveState(lead, { ...state, pending: null });
      return this.downgrade(ai);
    }
    if (pending?.kind === 'cancel' && pending.appointmentId === current.id) {
      await this.backend.cancel(tenantId, current);
      await this.leadRepo.update(lead.id, { appointmentAt: null } as any);
      if (state) await this.saveState(lead, { ...state, pending: null });
      ai.reply = `Prontinho, cancelei seu horário de *${current.service}* (${describeWhen(current.startDateTime)}). Se quiser marcar outro dia, é só me chamar 😊`;
      if (ai.stage === 'agendado') ai.stage = 'lead_quente';
      this.logger.log(`[TRINKS-IA] Cancelado appt ${current.id} (lead ${lead.id})`);
      return;
    }
    await this.saveState(lead, {
      ...(state ?? { serviceId: current.serviceId ?? '', date: formatInTZ(current.startDateTime).date, checkedAt: new Date().toISOString() }),
      checkedAt: state?.checkedAt && Date.now() - new Date(state.checkedAt).getTime() < STATE_TTL_MS ? state.checkedAt : new Date().toISOString(),
      pending: { kind: 'cancel', serviceId: current.serviceId, start: current.startDateTime.toISOString(), appointmentId: current.id, createdAt: new Date().toISOString() },
    });
    ai.reply = `Só confirmando: você quer cancelar o agendamento de *${current.service}* na *${describeWhen(current.startDateTime)}*? Posso cancelar?`;
    this.downgrade(ai);
  }

  // O horário pedido tem que estar na lista consultada. Se não estiver (IA pegou de mensagem
  // antiga, lista vencida), consulta o dia na Trinks agora; não tem vaga → conflito com alternativas.
  private async ensureSlotListed(tenantId: string, lead: Lead, svc: AgendaServiceEntity, start: Date): Promise<void> {
    const date = formatInTZ(start).date;
    const time = hhmm(start);
    const state = lead.agendaState;
    const fresh = !!state && Date.now() - new Date(state.checkedAt).getTime() < STATE_TTL_MS;
    if (fresh && state!.serviceId === svc.id && state!.days?.some((d) => d.date === date && d.times.includes(time))) return;
    const days = await this.backend.fetchDays(tenantId, svc, date, { live: true });
    const snapshot = days.map((d) => ({ date: d.date, weekday: d.weekday, times: d.slots.map((s) => s.time) }));
    await this.saveState(lead, { serviceId: svc.id, date, checkedAt: new Date().toISOString(), days: snapshot, unavailable: false, pending: null });
    if (snapshot.find((d) => d.date === date)?.times.includes(time)) return;
    const alt = snapshot.flatMap((d) => d.times.map((t) => ({ date: d.date, time: t }))).slice(0, 3);
    throw new AgendaConflictError('Horário fora da lista de horários livres', alt);
  }

  private downgrade(ai: AiResponse): void {
    ai.action = 'none';
    if (ai.stage === 'agendado' || ai.stage === 'perdido') ai.stage = 'lead_quente';
  }

  // Aviso ao salão com freio (no máximo 1 por assunto a cada 30 min) — Trinks fora do ar não
  // pode virar uma enxurrada de mensagens no WhatsApp da recepção.
  private alertSalon(tenantId: string, key: string, text: string): void {
    const k = `${tenantId}|${key}`;
    const last = this.lastAlert.get(k) ?? 0;
    if (Date.now() - last < ALERT_THROTTLE_MS) return;
    this.lastAlert.set(k, Date.now());
    void this.salon.notifySalon(tenantId, text);
  }
}
