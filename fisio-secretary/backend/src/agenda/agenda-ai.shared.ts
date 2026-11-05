import type { AiResponse } from '../ai/ai.service';

// Peças comuns aos dois fluxos de agenda da IA (agenda do CRM e agenda da Trinks).
// Ficam fora do agenda-ai.service.ts pra não haver import circular com agenda/trinks/.

export const STATE_TTL_MS = 2 * 3600 * 1000;
export const MAX_SLOTS_PER_DAY = 8;

// Partes que os motores de prompt encaixam no system prompt.
export interface AgendaPromptParts {
  rules: string; // estático por tenant (serviços + regras) — fica no prefixo cacheável
  jsonFields: string; // campos JSON do contrato com a agenda
  dynamic: string; // variável (horários + agendamento atual) — SEMPRE no fim do prompt
  codes: Record<string, string>; // "S1" → serviceId
  backend?: 'internal' | 'trinks'; // de onde vêm os horários (ausente = agenda do CRM)
}

export const AGENDA_JSON_FIELDS = `  "reply": "texto da resposta para a cliente",
  "stage": "novo_lead|lead_frio|lead_quente|agendado|perdido",
  "temperature": "quente|morno|frio",
  "action": "none|send_media|check_availability|schedule|reschedule|cancel",
  "mediaName": "id exato do catálogo (ou array de ids p/ vários) — só com action=send_media",
  "agendaServiceCode": "código do serviço da lista SERVIÇOS QUE PODEM SER AGENDADOS (ex.: S2) — com check_availability, schedule e reschedule",
  "agendaDate": "YYYY-MM-DD do dia que a cliente quer — com check_availability, SEMPRE pela TABELA DE DATAS",
  "appointmentDateTime": "YYYY-MM-DDTHH:MM:SS copiado da lista HORÁRIOS LIVRES — só com schedule e reschedule",
  "tags": [],
  "shouldIgnore": false,
  "fields": { "name": "nome se coletado ou null" }`;

export function formatDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? (m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`) : `${m} min`;
}

export function ddmm(date: string): string {
  return date.split('-').reverse().slice(0, 2).join('/');
}

// O histórico da conversa (lead.aiContext) guarda o JSON bruto da IA. Quando o sistema troca
// reply/action/stage (conflito, falha, resposta pronta), o JSON tem que acompanhar — senão no
// turno seguinte a IA "lembra" de uma resposta que a cliente nunca recebeu.
export function syncRawJson(ai: AiResponse): AiResponse {
  let base: any = {};
  try { base = ai.rawJson ? JSON.parse(ai.rawJson) : {}; } catch { base = {}; }
  ai.rawJson = JSON.stringify({ ...base, reply: ai.reply, action: ai.action, stage: ai.stage });
  return ai;
}

export function normalizeDate(v?: string | null): string | null {
  const m = (v ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

// "2026-10-23T14:00:00" (hora local de Brasília, sem fuso) → Date.
export function parseLocal(v?: string | null): Date | null {
  const m = (v ?? '').match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]}:${m[3]}:00-03:00`);
  return isNaN(d.getTime()) ? null : d;
}
