// Montagem do material que a IA analisa no relatório de vendas + validação do que ela
// devolve. Funções puras (sem banco) para ficarem testáveis.

export interface ReportMessage {
  direction: 'inbound' | 'outbound';
  sender: string; // 'ai' | 'operator' | telefone (inbound)
  content: string;
  createdAt: Date;
}

export interface ReportConversation {
  leadName: string | null;
  stage: string;
  temperature: string | null;
  messages: ReportMessage[];
}

export interface ReportMetrics {
  conversas: number;
  novosLeads: number;
  mensagensRecebidas: number;
  respostasIa: number;
  respostasEquipe: number;
  conversasComEquipe: number;
  agendados: number;
  vendas: number;
  perdidos: number;
  aguardandoResposta: number;
  // Volume por dia (gráfico do PDF/tela). Opcional: relatórios antigos não têm.
  porDia?: Array<{ dia: string; recebidas: number; ia: number; equipe: number }>;
}

export interface ReportItem { titulo: string; detalhe: string; exemplo?: string }
export interface ReportImprovement { problema: string; sugestao: string; exemplo?: string }
export interface ReportOpportunity { cliente: string; situacao: string; acao: string }

export interface SalesReportContent {
  resumo: string;
  acertos: ReportItem[];
  erros: ReportItem[];
  melhoriasIa: ReportImprovement[];
  melhoriasEquipe: ReportImprovement[];
  oportunidades: ReportOpportunity[];
  planoSemana: string[];
}

export const STAGE_LABEL: Record<string, string> = {
  novo_lead: 'Novo lead', lead_frio: 'Lead frio', lead_quente: 'Lead quente',
  agendado: 'Agendado', vendas: 'Vendas', perdido: 'Perdido', desliza_hair: 'Desliza Hair',
};

// Teto do material enviado: ~150 mil tokens. Uma semana da DALU dá ~170 mil caracteres
// (~45 mil tokens), então hoje vai tudo; o teto protege um cliente bem maior.
const MAX_TOTAL_CHARS = 600_000;
const MAX_MSG_CHARS = 500;
const MAX_MSGS_PER_CONVERSATION = 80;

const fmtDateTime = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    .format(d).replace(',', '');

const who = (m: ReportMessage) => (m.direction === 'inbound' ? 'Cliente' : m.sender === 'ai' ? 'IA' : 'Equipe');

// Conversas com mais mensagens primeiro (onde mais aconteceu); se passar do teto, as
// menores ficam de fora e o prompt avisa quantas.
export function buildTranscript(conversations: ReportConversation[]): { text: string; included: number; omitted: number } {
  const ordered = [...conversations].sort((a, b) => b.messages.length - a.messages.length);
  const blocks: string[] = [];
  let total = 0;
  let omitted = 0;
  for (const c of ordered) {
    const msgs = c.messages.slice(-MAX_MSGS_PER_CONVERSATION);
    const header = `### Cliente: ${c.leadName?.trim() || 'Sem nome'} (raia: ${STAGE_LABEL[c.stage] ?? c.stage}${c.temperature ? `, temperatura: ${c.temperature}` : ''}) — ${c.messages.length} mensagens`;
    const lines = msgs.map((m) => {
      const text = (m.content ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_MSG_CHARS);
      return `[${fmtDateTime(m.createdAt)}] ${who(m)}: ${text}`;
    });
    const block = [header, ...lines].join('\n');
    if (total + block.length > MAX_TOTAL_CHARS) { omitted++; continue; }
    blocks.push(block);
    total += block.length;
  }
  return { text: blocks.join('\n\n'), included: blocks.length, omitted };
}

export function buildSystemPrompt(businessName: string): string {
  return `Você é uma consultora de vendas experiente analisando o atendimento por WhatsApp de "${businessName}", um salão/loja de mega hair.
No atendimento há dois atores do lado do negócio: a "IA" (assistente virtual que responde sozinha) e a "Equipe" (pessoas do time que assumem a conversa).
Seu objetivo: ajudar a dona a VENDER MAIS na próxima semana, mostrando com franqueza o que funcionou, o que deu errado e o que mudar.

Regras:
- Baseie-se SÓ nas conversas e números fornecidos. Nunca invente cliente, fala, valor ou resultado.
- Nunca use marcadores no lugar de dados (ex.: "R$X", "[valor]", "[Nome do Cliente]"). Se não souber o preço ou o nome, escreva a frase sem ele.
- Seja específica e prática: cada ponto precisa dizer o que aconteceu e o que fazer. Nada de conselho genérico.
- Sempre que possível, cite um exemplo real curto (primeiro nome da cliente + trecho da fala, até 200 caracteres).
- Separe bem o que é da IA (como ela responde, conduz, perde ou fecha) e o que é da Equipe (tempo de resposta, abordagem, fechamento, follow-up).
- No máximo 6 itens por lista. Lista vazia se não houver nada relevante.
- Português do Brasil, tom direto e respeitoso, escrito para a dona do negócio (não para programador).

Responda APENAS um JSON com este formato:
{
  "resumo": "3 a 5 frases com o panorama da semana",
  "acertos": [{ "titulo": "...", "detalhe": "...", "exemplo": "..." }],
  "erros": [{ "titulo": "...", "detalhe": "o que aconteceu e o impacto na venda", "exemplo": "..." }],
  "melhoriasIa": [{ "problema": "...", "sugestao": "o que mudar no comportamento/instruções da IA", "exemplo": "..." }],
  "melhoriasEquipe": [{ "problema": "...", "sugestao": "o que o time deve fazer diferente", "exemplo": "..." }],
  "oportunidades": [{ "cliente": "primeiro nome", "situacao": "por que ainda dá pra vender", "acao": "o que fazer ou a mensagem a mandar (sem prefixo tipo 'Ação sugerida:')" }],
  "planoSemana": ["ação 1", "ação 2", "ação 3"]
}`;
}

export function buildUserPrompt(metrics: ReportMetrics, periodLabel: string, transcript: { text: string; included: number; omitted: number }): string {
  const m = metrics;
  return `Período analisado: ${periodLabel}

NÚMEROS DA SEMANA (calculados pelo sistema, confiáveis):
- Conversas com mensagem no período: ${m.conversas}
- Leads novos: ${m.novosLeads}
- Mensagens recebidas de clientes: ${m.mensagensRecebidas}
- Respostas da IA: ${m.respostasIa}
- Respostas da Equipe: ${m.respostasEquipe} (em ${m.conversasComEquipe} conversas)
- Entraram em Agendado: ${m.agendados} · Entraram em Vendas: ${m.vendas} · Marcados como Perdido: ${m.perdidos}
- Conversas em que a cliente falou por último e ainda está sem resposta: ${m.aguardandoResposta}

CONVERSAS (${transcript.included} incluídas${transcript.omitted ? `, ${transcript.omitted} menores ficaram de fora por tamanho` : ''}):

${transcript.text || '(nenhuma conversa no período)'}`;
}

const str = (v: unknown, max = 1200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
// A IA às vezes repete o rótulo do campo no começo ("Mensagem/ação sugerida: ...") — a tela e
// o PDF já mostram o rótulo.
const stripLabel = (v: string) => v.replace(/^((mensagem|a[çc][ãa]o)(\s*\/\s*(mensagem|a[çc][ãa]o))?(\s+sugerida)?\s*:\s*)+/i, '').trim();
const list = <T>(v: unknown, map: (x: any) => T | null): T[] =>
  (Array.isArray(v) ? v : []).map(map).filter((x): x is T => !!x).slice(0, 8);

// A IA às vezes devolve campo faltando/tipo errado — normaliza para a tela e o PDF nunca
// quebrarem. Item sem o texto principal é descartado.
export function parseReportContent(raw: string): SalesReportContent {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
  const j = JSON.parse(cleaned);
  return {
    resumo: str(j.resumo, 2000),
    acertos: list(j.acertos, (x) => (str(x?.titulo) ? { titulo: str(x.titulo, 200), detalhe: str(x.detalhe), exemplo: str(x.exemplo, 300) || undefined } : null)),
    erros: list(j.erros, (x) => (str(x?.titulo) ? { titulo: str(x.titulo, 200), detalhe: str(x.detalhe), exemplo: str(x.exemplo, 300) || undefined } : null)),
    melhoriasIa: list(j.melhoriasIa, (x) => (str(x?.problema) ? { problema: str(x.problema, 300), sugestao: str(x.sugestao), exemplo: str(x.exemplo, 300) || undefined } : null)),
    melhoriasEquipe: list(j.melhoriasEquipe, (x) => (str(x?.problema) ? { problema: str(x.problema, 300), sugestao: str(x.sugestao), exemplo: str(x.exemplo, 300) || undefined } : null)),
    oportunidades: list(j.oportunidades, (x) => (str(x?.cliente) || str(x?.situacao) ? { cliente: str(x.cliente, 80) || 'Cliente', situacao: str(x.situacao), acao: stripLabel(str(x.acao)) } : null)),
    planoSemana: list(j.planoSemana, (x) => (str(x) ? str(x, 400) : null)),
  };
}

// Preço por 1M tokens (USD) — mesmo critério do _trackUsage do AiService para o Gemini.
const PRICES: Record<string, { input: number; cached: number; output: number }> = {
  'gemini-2.5-flash': { input: 0.30, cached: 0.03, output: 2.50 },
  'gpt-4o-mini': { input: 0.15, cached: 0.075, output: 0.60 },
};

export function estimateCostUsd(model: string, inputTokens: number, cachedTokens: number, outputTokens: number): number {
  const p = PRICES[model] ?? PRICES['gemini-2.5-flash'];
  return ((inputTokens - cachedTokens) * p.input + cachedTokens * p.cached + outputTokens * p.output) / 1_000_000;
}
