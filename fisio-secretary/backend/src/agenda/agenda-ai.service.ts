import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Lead } from '../common/entities/lead.entity';
import { AgendaServiceEntity } from '../common/entities/agenda-service.entity';
import type { AiResponse } from '../ai/ai.service';
import { formatInTZ } from '../common/utils/sp-time.util';
import { AgendaConflictError, AgendaService } from './agenda.service';
import { formatWhen } from './agenda-notifier';
import { AGENDA_JSON_FIELDS, AgendaPromptParts, ddmm, formatDuration as duration, MAX_SLOTS_PER_DAY, normalizeDate, parseLocal, STATE_TTL_MS, syncRawJson } from './agenda-ai.shared';
import { TrinksAiFlow } from './trinks/trinks-ai.flow';

export { AGENDA_JSON_FIELDS, normalizeDate, parseLocal, syncRawJson };
export type { AgendaPromptParts };

// Ponte entre a IA (contrato JSON de sempre) e a agenda com profissionais. Sem function calling:
// a IA pede uma consulta (action=check_availability), o controller chama a IA de novo com os
// horários livres no fim do prompt, e só confirma "agendado" depois que o book() deu certo.

function money(v: string | null): string {
  if (v === null || v === undefined) return '';
  return `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function buildAgendaRules(services: AgendaServiceEntity[]): { rules: string; codes: Record<string, string> } {
  const codes: Record<string, string> = {};
  const lines = services.map((s, i) => {
    const code = `S${i + 1}`;
    codes[code] = s.id;
    const price = [money(s.price), s.priceNote ?? ''].filter(Boolean).join(' — ');
    return `- ${code} — ${s.name} — ${duration(s.durationMinutes)}${price ? ` — ${price}` : ''}`;
  });
  const rules = `════════ AGENDA DO SALÃO (você marca direto na agenda) ════════
SERVIÇOS QUE PODEM SER AGENDADOS (código — nome — duração — preço):
${lines.length ? lines.join('\n') : '- (nenhum serviço cadastrado — não agende; diga que a equipe confirma o horário)'}

COMO AGENDAR (um passo por mensagem):
1. Descubra QUAL serviço ela quer (escolha o código certo pela lista; se ficar em dúvida entre dois, pergunte) e QUAL DIA ela prefere.
2. Com serviço + dia definidos e SEM a lista HORÁRIOS LIVRES desse serviço no final do prompt: action="check_availability", agendaServiceCode e agendaDate. O sistema consulta a agenda e te devolve a lista.
   Se a lista HORÁRIOS LIVRES desse serviço JÁ ESTÁ no final do prompt, NÃO use check_availability de novo — use a lista (passo 3). Só consulte de novo se ela mudar de serviço ou pedir um dia que não aparece na lista.
3. Com a lista HORÁRIOS LIVRES: ofereça até 3 horários do dia que ela pediu (os primeiros). Se esse dia não tiver vaga, diga isso e ofereça o dia mais próximo que aparece na lista. action="none".
4. Quando ela escolher ou pedir um horário QUE ESTÁ NA LISTA (mesmo que você não tenha oferecido esse horário antes): action="schedule", agendaServiceCode, appointmentDateTime exatamente como na lista, stage="agendado". No reply, confirme serviço + dia + horário. A lista do final do prompt é a verdade de agora — vale mais do que horários citados antes na conversa.
REMARCAR: se ela já tem um agendamento (ver AGENDAMENTO ATUAL DA CLIENTE) e quer outro dia ou horário: se a lista HORÁRIOS LIVRES do novo dia ainda NÃO está no final do prompt, faça check_availability desse dia (mesmo serviço); com a lista, ofereça os horários e, quando ela escolher, action="reschedule" com o novo appointmentDateTime.
CANCELAR: se ela pedir para cancelar o agendamento atual: action="cancel" e confirme no reply.

PROIBIDO:
- Oferecer ou agendar horário que não está na lista HORÁRIOS LIVRES. Nunca invente, arredonde ou calcule horário.
- Dizer que está agendado/remarcado/cancelado sem usar action="schedule"/"reschedule"/"cancel".
- Falar de profissional ou deixar a cliente escolher profissional — o salão define quem atende.
- Prometer preço diferente da lista. Se o serviço tiver observação de preço (ex.: "por grama"), explique.`;
  return { rules, codes };
}

// Bloco completo pro motor antigo (processMessageMegaHair): regras de etapa + agenda + JSON.
// Substitui o JSON_FORMAT_MEGAHAIR* (que manda agendar 09:00 fixo).
export function buildLegacyAgendaFormat(parts: AgendaPromptParts): string {
  return `

════════════════════════════════════════════════════════════════
REGRAS DE STAGE (CRÍTICO — OBEDEÇA SEMPRE)
════════════════════════════════════════════════════════════════
A cada mensagem, reavalie o stage:
- "lead_quente": interesse claro (perguntou preço, serviço, horário, quis ver mídia, já usa mega hair).
- "lead_frio": nunca usou e sem interesse imediato.
- "agendado": SOMENTE junto com action="schedule" ou "reschedule".
- "perdido": desistiu, foi rude ou pediu algo que o salão não faz.
- "novo_lead": só na primeira mensagem.
TAGS: tags=["qualificado"] quando ela confirmar que já usa ou já usou mega hair; senão tags=[].

${parts.rules}

${buildAgendaJsonSchema()}`;
}

export function buildAgendaJsonSchema(extraFields = ''): string {
  return `RESPONDA SEMPRE em JSON com este formato exato (NÃO inclua campos além destes):
{
${AGENDA_JSON_FIELDS}${extraFields}
}`;
}

@Injectable()
export class AgendaAiService {
  private readonly logger = new Logger(AgendaAiService.name);

  constructor(
    private readonly agenda: AgendaService,
    @InjectRepository(Lead) private readonly leadRepo: Repository<Lead>,
    // Agenda da Trinks (tenant_schedules.mode='trinks'). Opcional: os specs antigos não passam.
    @Optional() private readonly trinks?: TrinksAiFlow,
  ) {}

  // null = tenant sem agenda com profissionais ou com a IA proibida de agendar → fluxo antigo.
  // `justChecked`: 2ª chamada da mesma rodada — o bloco avisa que a consulta pedida acabou de ser feita.
  async prepare(tenantId: string, lead: Lead, justChecked = false): Promise<AgendaPromptParts | null> {
    if (this.trinks) {
      const viaTrinks = await this.trinks.prepare(tenantId, lead, justChecked);
      if (viaTrinks !== undefined) return viaTrinks; // undefined = cliente não usa a Trinks
    }
    if (!(await this.agenda.isAiBookingEnabled(tenantId))) return null;
    const services = await this.agenda.listServices(tenantId, false);
    const { rules, codes } = buildAgendaRules(services);
    const dynamic = await this.buildDynamic(tenantId, lead, services, codes, justChecked);
    return { rules, jsonFields: AGENDA_JSON_FIELDS, dynamic, codes, backend: 'internal' };
  }

  private async buildDynamic(tenantId: string, lead: Lead, services: AgendaServiceEntity[], codes: Record<string, string>, justChecked = false): Promise<string> {
    const codeOf = (id: string) => Object.keys(codes).find((c) => codes[c] === id);
    const parts: string[] = ['════════ AGENDA AGORA (consultado neste instante) ════════'];

    const current = await this.agenda.nextActiveForLead(tenantId, lead.id);
    if (current) {
      const code = current.serviceId ? codeOf(current.serviceId) : undefined;
      parts.push(`AGENDAMENTO ATUAL DA CLIENTE: ${code ? `${code} ` : ''}${current.service} — ${formatWhen(current.startDateTime)}`);
    } else {
      parts.push('AGENDAMENTO ATUAL DA CLIENTE: nenhum');
    }

    const state = lead.agendaState;
    const fresh = state && Date.now() - new Date(state.checkedAt).getTime() < STATE_TTL_MS;
    const svc = fresh ? services.find((s) => s.id === state!.serviceId) : undefined;
    if (svc) {
      const days = await this.agenda.getSlots(tenantId, svc.id, state!.date, 7);
      const withSlots = days.filter((d) => d.slots.length);
      const requested = days.find((d) => d.date === state!.date);
      const shown = [requested, ...withSlots.filter((d) => d.date !== state!.date)].filter(Boolean).slice(0, 3) as typeof days;
      const lines = shown.map((d) => {
        const times = d.slots.slice(0, MAX_SLOTS_PER_DAY).map((s) => s.time);
        return `- ${d.weekday} ${ddmm(d.date)} (${d.date}): ${times.length ? times.join(', ') : 'SEM VAGA'}`;
      });
      parts.push(`HORÁRIOS LIVRES — ${codeOf(svc.id)} ${svc.name} (${duration(svc.durationMinutes)}) — consulta JÁ FEITA, use esta lista (não chame check_availability de novo pra este serviço): se ela ainda não escolheu, ofereça horários daqui; se escolheu um daqui, action="schedule":`);
      parts.push(lines.length ? lines.join('\n') : '- nenhum horário livre nos próximos dias — diga que a equipe vai confirmar um horário');
      if (justChecked) {
        parts.push('⚠️ ESTA É A CONSULTA QUE VOCÊ ACABOU DE PEDIR. Agora responda à cliente usando esta lista (action="none" para oferecer; "schedule"/"reschedule" se ela já disse um horário que está aqui). É PROIBIDO responder check_availability nesta mensagem.');
      }
    } else {
      parts.push('HORÁRIOS LIVRES: ainda não consultados — quando souber serviço + dia, use action="check_availability".');
    }
    return parts.join('\n');
  }

  // action=check_availability → grava o que consultar. false = pedido inválido (serviço/dia).
  async registerCheck(tenantId: string, lead: Lead, ai: AiResponse, parts: AgendaPromptParts): Promise<boolean> {
    if (parts.backend === 'trinks' && this.trinks) return this.trinks.registerCheck(tenantId, lead, ai, parts);
    const serviceId = parts.codes[(ai.agendaServiceCode ?? '').trim().toUpperCase()];
    const date = normalizeDate(ai.agendaDate) ?? normalizeDate(ai.appointmentDateTime?.slice(0, 10));
    if (!serviceId) return false;
    const today = formatInTZ(new Date()).date;
    const state = { serviceId, date: date && date >= today ? date : today, checkedAt: new Date().toISOString() };
    await this.leadRepo.update(lead.id, { agendaState: state } as any);
    lead.agendaState = state;
    this.logger.log(`[AGENDA-IA] Consulta ${ai.agendaServiceCode} em ${state.date} (lead ${lead.id})`);
    return true;
  }

  // Resposta pronta quando a 2ª chamada da IA falha ou pede outra consulta.
  async fallbackReply(tenantId: string, lead: Lead): Promise<string> {
    const state = lead.agendaState;
    if (this.trinks && state && (state.days !== undefined || state.unavailable)) return this.trinks.fallbackReply(lead);
    if (!state) return 'Qual serviço você quer agendar e pra qual dia?';
    const days = await this.agenda.getSlots(tenantId, state.serviceId, state.date, 7);
    const day = days.find((d) => d.date === state.date && d.slots.length) ?? days.find((d) => d.slots.length);
    if (!day) return 'Não encontrei horário livre nos próximos dias 😕 Vou pedir pra equipe te confirmar um horário, tá?';
    const prefix = day.date === state.date ? `No dia ${ddmm(day.date)}` : `Nesse dia não tenho vaga 😕 No dia ${ddmm(day.date)}`;
    return `${prefix} tenho livre: ${day.slots.slice(0, MAX_SLOTS_PER_DAY).map((s) => s.time).join(', ')}. Qual fica melhor pra você?`;
  }

  // Executa schedule/reschedule/cancel e ajusta o aiResponse (reply/stage/action) conforme o
  // resultado REAL — a cliente só ouve "agendado" se o agendamento existir de verdade.
  async applyAction(tenantId: string, lead: Lead, ai: AiResponse, parts: AgendaPromptParts): Promise<void> {
    if (parts.backend === 'trinks' && this.trinks) {
      try {
        await this.trinks.applyAction(tenantId, lead, ai, parts);
      } finally {
        syncRawJson(ai);
      }
      return;
    }
    const action = ai.action as string;
    if (!['schedule', 'reschedule', 'cancel'].includes(action)) return;
    try {
      await this.runAction(tenantId, lead, ai, parts, action);
    } finally {
      syncRawJson(ai);
    }
  }

  private async runAction(tenantId: string, lead: Lead, ai: AiResponse, parts: AgendaPromptParts, action: string): Promise<void> {
    try {
      if (action === 'cancel') {
        const current = await this.agenda.nextActiveForLead(tenantId, lead.id);
        if (!current) {
          ai.reply = 'Não encontrei nenhum agendamento ativo no seu nome por aqui 🤔 Quer marcar um horário?';
          ai.action = 'none';
          if (ai.stage === 'agendado' || ai.stage === 'perdido') ai.stage = 'lead_quente';
          this.logger.log(`[AGENDA-IA] Pedido de cancelamento sem agendamento ativo (lead ${lead.id})`);
          return;
        }
        await this.agenda.cancel(tenantId, current.id, 'ia');
        await this.leadRepo.update(lead.id, { appointmentAt: null } as any);
        if (ai.stage === 'agendado') ai.stage = 'lead_quente';
        this.logger.log(`[AGENDA-IA] Cancelado appt ${current.id} (lead ${lead.id})`);
        return;
      }

      const start = parseLocal(ai.appointmentDateTime);
      if (!start) {
        ai.reply = 'Me confirma o dia e o horário que você prefere, por favor?';
        ai.action = 'none';
        ai.stage = 'lead_quente';
        return;
      }
      const current = await this.agenda.nextActiveForLead(tenantId, lead.id);
      const serviceId = parts.codes[(ai.agendaServiceCode ?? '').trim().toUpperCase()] ?? current?.serviceId ?? lead.agendaState?.serviceId;
      if (!serviceId) {
        ai.reply = 'Qual serviço você quer agendar?';
        ai.action = 'none';
        ai.stage = 'lead_quente';
        return;
      }

      const appt = action === 'reschedule' && current
        ? await this.agenda.reschedule(tenantId, current.id, { start, serviceId, professionalId: null }, { source: 'ia' })
        : await this.agenda.book({ tenantId, serviceId, start, leadId: lead.id, clientName: ai.fields?.name || lead.name || lead.phone, clientPhone: lead.phone, source: 'ia' });
      await this.leadRepo.update(lead.id, { appointmentAt: appt.startDateTime } as any);
      ai.stage = 'agendado';
      this.logger.log(`[AGENDA-IA] ${action === 'reschedule' && current ? 'Remarcado' : 'Agendado'} appt ${appt.id} em ${appt.startDateTime.toISOString()} (lead ${lead.id})`);
    } catch (err) {
      if (err instanceof AgendaConflictError) {
        const alt = err.alternatives;
        ai.reply = alt.length
          ? `Esse horário acabou de ser preenchido 😕 Tenho livre: ${alt.map((a) => `${ddmm(a.date)} às ${a.time}`).join(', ')}. Qual fica melhor pra você?`
          : 'Esse horário acabou de ser preenchido 😕 Vou pedir pra equipe te confirmar outro horário, tá?';
      } else {
        this.logger.error(`[AGENDA-IA] Falha em ${action} (lead ${lead.id}): ${err?.message}`);
        ai.reply = 'Tive um probleminha pra marcar aqui 😕 Vou pedir pra equipe confirmar seu horário certinho, tá?';
      }
      ai.action = 'none';
      ai.stage = 'lead_quente';
    }
  }
}
