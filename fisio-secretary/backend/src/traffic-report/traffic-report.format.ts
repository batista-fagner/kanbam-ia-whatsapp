// Texto do relatório semanal de tráfego pago. Tudo aqui é função pura (sem banco, sem
// rede) de propósito: os números que vão para o grupo do cliente saem de conta em código,
// nunca de IA — um número errado no grupo do cliente é pior que um texto sem graça.

export const MESSAGING_ACTION = 'onsite_conversion.messaging_conversation_started_7d';

export interface PeriodMetrics {
  spend: number;
  impressions: number;
  reach: number;
  frequency: number;
  ctr: number; // em %, como a Meta devolve (ex: 4.57)
  cpm: number;
  conversations: number;
}

export interface TopAd {
  name: string;
  spend: number;
  conversations: number;
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

export function actionValue(actions: unknown, actionType: string): number {
  if (!Array.isArray(actions)) return 0;
  const hit = actions.find((a: any) => a?.action_type === actionType);
  return hit ? num(hit.value) : 0;
}

// Linha de /insights da Meta → métricas do período. Linha ausente (sem veiculação) = zeros.
export function parseInsightsRow(row: any): PeriodMetrics {
  return {
    spend: num(row?.spend),
    impressions: num(row?.impressions),
    reach: num(row?.reach),
    frequency: num(row?.frequency),
    ctr: num(row?.ctr),
    cpm: num(row?.cpm),
    conversations: actionValue(row?.actions, MESSAGING_ACTION),
  };
}

export function parseTopAd(rows: any[]): TopAd | null {
  const ads = (rows ?? [])
    .map((r) => ({
      name: String(r?.ad_name ?? ''),
      spend: num(r?.spend),
      conversations: actionValue(r?.actions, MESSAGING_ACTION),
    }))
    .filter((a) => a.conversations > 0);
  if (ads.length === 0) return null;
  return ads.sort((a, b) => b.conversations - a.conversations)[0];
}

// ───────────────────────── Datas (dia civil, "YYYY-MM-DD") ─────────────────────────

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Relatório enviado no dia D cobre os 7 dias completos anteriores (D-7 a D-1): às 19h o
// próprio dia D ainda está pela metade e distorceria o custo.
export function reportPeriod(runDate: string): { since: string; until: string } {
  return { since: addDays(runDate, -7), until: addDays(runDate, -1) };
}

export function previousPeriod(period: { since: string }): { since: string; until: string } {
  return { since: addDays(period.since, -7), until: addDays(period.since, -1) };
}

// Próxima data sempre no mesmo dia da semana: se o servidor ficou fora do ar e pulou uma
// rodada, avança de 7 em 7 a partir da data combinada em vez de "hoje + 7".
export function nextReportDate(current: string, runDate: string): string {
  let next = addDays(current, 7);
  while (next <= runDate) next = addDays(next, 7);
  return next;
}

// ───────────────────────── Formatação pt-BR ─────────────────────────

export function fmtInt(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function fmtMoney(n: number): string {
  const [int, dec] = n.toFixed(2).split('.');
  return `R$ ${int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dec}`;
}

export function fmtDay(date: string): string {
  const [, m, d] = date.split('-');
  return `${d}/${m}`;
}

const costPerConversation = (m: PeriodMetrics): number =>
  m.conversations > 0 ? m.spend / m.conversations : 0;

// ───────────────────────── Textos ─────────────────────────

// Texto que vai para o grupo do cliente: sem jargão (nada de CTR, frequência, criativo).
export function buildClientText(
  clientName: string,
  period: { since: string; until: string },
  cur: PeriodMetrics,
  prev: PeriodMetrics | null,
): string {
  const days = 7;
  const lines: string[] = [
    `*Relatório ${clientName} | ${fmtDay(period.since)} a ${fmtDay(period.until)}* 📊`,
    '',
  ];

  if (cur.conversations > 0) {
    const perDay = Math.round(cur.conversations / days);
    lines.push(
      `💬 *${fmtInt(cur.conversations)} pessoas* chamaram no WhatsApp pelos anúncios` +
        (perDay >= 2 ? ` (cerca de ${fmtInt(perDay)} por dia)` : ''),
    );
  }
  lines.push(`💰 Investido: *${fmtMoney(cur.spend)}*`);
  if (cur.conversations > 0) {
    lines.push(`🎯 Cada conversa saiu por *${fmtMoney(costPerConversation(cur))}*`);
  }
  lines.push(`👥 *${fmtInt(cur.reach)} pessoas* diferentes viram os anúncios`);

  if (prev && prev.conversations > 0 && cur.conversations > 0) {
    lines.push(
      '',
      `Na semana anterior foram ${fmtInt(prev.conversations)} conversas, a ${fmtMoney(costPerConversation(prev))} cada.`,
    );
  }

  lines.push(
    '',
    '*Um pedido:* nos contem quantas dessas conversas viraram venda. Assim calculamos quanto custa cada venda de verdade, que é o que mais importa. 🙌',
  );
  return lines.join('\n');
}

// Bloco que só o aprovador vê: os sinais técnicos que não vão para o cliente.
export function buildInternalNote(cur: PeriodMetrics, prev: PeriodMetrics | null, topAd: TopAd | null): string {
  const lines: string[] = [
    `Frequência ${cur.frequency.toFixed(2).replace('.', ',')} · CTR ${cur.ctr.toFixed(2).replace('.', ',')}% · CPM ${fmtMoney(cur.cpm)}`,
  ];
  if (prev && prev.spend > 0) {
    lines.push(
      `Semana anterior: ${fmtMoney(prev.spend)} investidos, ${fmtInt(prev.conversations)} conversas` +
        (prev.conversations > 0 ? `, ${fmtMoney(costPerConversation(prev))} cada` : ''),
    );
  } else {
    lines.push('Semana anterior: sem investimento.');
  }
  if (topAd && cur.conversations > 0) {
    const share = Math.round((topAd.conversations / cur.conversations) * 100);
    lines.push(`Anúncio que mais trouxe conversa: "${topAd.name}" (${fmtInt(topAd.conversations)} conversas, ${share}% do total)`);
  }
  if (cur.conversations === 0) {
    lines.push('⚠️ Houve investimento, mas nenhuma conversa no WhatsApp foi registrada no período.');
  }
  return lines.join('\n');
}
