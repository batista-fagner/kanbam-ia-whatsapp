import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import OpenAI from 'openai';
import { Lead } from '../common/entities/lead.entity';
import { TokenUsage } from '../common/entities/token-usage.entity';

export interface AiResponse {
  reply: string;
  success?: boolean;
  rawJson?: string;
  stage?: string;
  temperature?: string;
  action?: 'schedule' | 'cancel' | 'reschedule' | 'send_media' | 'none';
  mediaName?: string | string[]; // nome(s) da mídia cadastrada (quando action='send_media'). Array = enviar vários vídeos.
  appointmentDateTime?: string; // ISO 8601: "2026-03-28T09:00:00"
  appointmentService?: 'mega_hair' | 'manutencao' | null; // MegaHair: tipo do serviço
  appointmentValue?: number | null; // MegaHair: valor em reais
  tags?: string[]; // Tags para marcar lead como inativo, desrespeitoso, etc
  shouldIgnore?: boolean; // Se true, não responder mais mensagens deste lead
  handoff?: boolean; // Multi-agente: true = o agente pediu pra passar o bastão pro supervisor
  tokenUsage?: { inputTokens: number; cachedTokens: number; outputTokens: number }; // Multi-agente: consumo desta chamada (contador de teste)
  fields?: {
    name?: string;
    symptoms?: string;
    urgency?: string;
    availability?: string;
    budget?: string;
    qualificationScore?: number;
    qualificationStep?: number;
  };
}

async function callWithRetry<T>(
  fn: () => Promise<T>,
  logger: Logger,
  attempts = 3,
  delaysMs = [1000, 2000],
): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      const isOverload = err?.status === 429 || err?.status === 529 || err?.status === 503 || /overload|rate_limit/i.test(err?.message ?? '');
      if (isOverload && i < attempts - 1) {
        const wait = delaysMs[i] ?? 2000;
        logger.warn(`API overloaded/rate limited (tentativa ${i + 1}/${attempts}) — aguardando ${wait}ms`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }
  throw new Error('callWithRetry: máximo de tentativas atingido');
}

const JSON_FORMAT_MEGAHAIR = `

════════════════════════════════════════════════════════════════
REGRAS DE STAGE E AGENDAMENTO (CRÍTICO — OBEDEÇA SEMPRE)
════════════════════════════════════════════════════════════════
A cada mensagem, vc DEVE reavaliar o stage. Não deixe o lead parado em "novo_lead" se a conversa já evoluiu.

TRANSIÇÕES OBRIGATÓRIAS:
1. stage="lead_quente" — Use SEMPRE que a cliente disser que JÁ USA, JÁ USOU mega hair, ou demonstrar interesse claro no produto (perguntou preço, perguntou textura, quis ver vídeo). Esta é a transição mais comum — não esqueça.
2. stage="lead_frio" — Use quando a cliente disser que NUNCA usou mega hair E não mostrou interesse imediato.
3. stage="agendado" — Use quando a cliente disser que vai à loja em algum dia (ver REGRAS DE AGENDAMENTO abaixo). SEMPRE acompanhado de action="schedule" + appointmentDateTime preenchido. stage="agendado" + action="none" é INVÁLIDO.
4. stage="perdido" — Use quando a cliente desistir, for rude, ou pedir produto fora do catálogo após tentativa de transferência.
5. stage="novo_lead" — APENAS na primeira mensagem ou antes de qualquer qualificação real.

REGRAS DE AGENDAMENTO (NÃO PEÇA CONFIRMAÇÃO DE HORÁRIO):
Quando a cliente disser que vai à loja, agende DIRETO sem pedir horário (horário padrão = 09:00).
Escolha o caminho conforme a clareza da data:

CAMINHO A — DATA ESPECÍFICA ("amanhã", "depois de amanhã", "sexta", "dia 25", "26/05", "hoje"):
  → Resolva a data pela tabela acima.
  → action="schedule"
  → appointmentDateTime = "YYYY-MM-DDT09:00:00" (sempre 09:00)
  → appointmentService = "mega_hair" (primeira vez) ou "manutencao" (cliente já foi nossa antes)
  → appointmentValue = valor combinado em reais, ou null se ainda não combinou
  → stage = "agendado"
  → tags = [] (nem precisa "data-aproximada")
  → reply: confirme citando a data, ex: "Show! Agendado pra amanhã, dia 22/05 (quinta). Te espero! 😊"

CAMINHO B — DATA VAGA ("semana que vem", "mês que vem", "qualquer dia da próxima semana"):
  → "semana que vem" / "próxima semana" → leia a linha "semana que vem" em EXPRESSÕES VAGAS da tabela e copie exatamente essa data. NÃO calcule, NÃO some dias.
  → "mês que vem" / "próximo mês" → leia a linha "mês que vem" em EXPRESSÕES VAGAS da tabela e copie exatamente essa data. NÃO calcule.
  → action = "schedule"
  → appointmentDateTime = "YYYY-MM-DDT09:00:00"
  → appointmentService = "mega_hair" ou "manutencao"
  → stage = "agendado"
  → tags = ["data-aproximada"] OBRIGATÓRIO — sinaliza pra operadora confirmar a data exata depois.
  → reply: explique sua escolha, ex: "Vou deixar pré-agendado pra terça, dia 28/05. Quando se aproximar a gente confirma a data certinha, beleza? 👌"

PROIBIDO:
- Definir stage="vendas" ou stage="desliza_hair" — essas raias são da vendedora humana.
- Manter stage="novo_lead" depois que a cliente já respondeu se usa mega hair.
- Usar stage="agendado" sem action="schedule" — são INSEPARÁVEIS.
- Usar action="schedule" sem appointmentDateTime preenchida.
- PERGUNTAR horário pra cliente (manhã/tarde, "que horas?"). Use sempre 09:00.
- PEDIR confirmação ("pode? posso fechar?") quando a cliente já disse o dia. Agende direto.

REGRA DE TAGS (OBRIGATÓRIA):
- tags=["qualificado"] — quando a cliente confirmar que JÁ USA ou JÁ USOU mega hair.
- tags=["data-aproximada"] — quando agendar via CAMINHO B (data vaga). Pode combinar com "qualificado" se ambas se aplicarem.
- tags=[] nos demais casos.

RESPONDA SEMPRE em JSON com este formato exato:
{
  "reply": "texto da resposta para a cliente",
  "stage": "novo_lead|lead_frio|lead_quente|agendado|perdido",
  "temperature": "quente|morno|frio",
  "action": "schedule|send_media|none",
  "mediaName": "id-exato-ou-null (ou um array de ids quando enviar vários vídeos)",
  "appointmentDateTime": "YYYY-MM-DDTHH:MM:SS ou null",
  "appointmentService": "mega_hair|manutencao|null",
  "appointmentValue": null,
  "tags": [],
  "shouldIgnore": false,
  "fields": {
    "name": "nome se coletado ou null"
  }
}`;

function buildDateBlock(): string {
  // Usa timezone de São Paulo para evitar bug em servidor UTC (Railway).
  const TZ = 'America/Sao_Paulo';
  const dayNames = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  const dayShort = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

  const formatInTZ = (d: Date) => {
    const parts = new Intl.DateTimeFormat('pt-BR', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'long',
    }).formatToParts(d);
    return {
      day: parts.find(p => p.type === 'day')!.value,
      month: parts.find(p => p.type === 'month')!.value,
      year: parts.find(p => p.type === 'year')!.value,
      weekday: parts.find(p => p.type === 'weekday')!.value,
    };
  };

  const now = new Date();
  const today = formatInTZ(now);
  const todayIdx = dayNames.indexOf(today.weekday);
  const dayInfo = (offset: number) => formatInTZ(new Date(now.getTime() + offset * 86400000));

  // Hora atual em São Paulo → define a saudação correta (bom dia / boa tarde / boa noite)
  const currentHour = parseInt(
    new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', hour12: false }).format(now),
    10,
  );
  const greeting = currentHour < 12 ? 'Bom dia' : currentHour < 18 ? 'Boa tarde' : 'Boa noite';

  const labels = ['amanhã', 'depois de amanhã', 'em 3 dias', 'em 4 dias', 'em 5 dias', 'em 6 dias', 'em 7 dias'];
  const relativeLookup = [`- "hoje" = ${today.day}/${today.month}/${today.year} (${today.weekday})`];
  for (let i = 0; i < 7; i++) {
    const info = dayInfo(i + 1);
    relativeLookup.push(`- "${labels[i]}" = ${info.day}/${info.month}/${info.year} (${info.weekday})`);
  }

  const weekdayLookup: string[] = [];
  for (let i = 0; i < 7; i++) {
    let aheadDays = (i - todayIdx + 7) % 7;
    if (aheadDays === 0) aheadDays = 7;
    const info = dayInfo(aheadDays);
    weekdayLookup.push(`- "${dayShort[i]}" / "${dayNames[i]}" (próxima) = ${info.day}/${info.month}/${info.year} (${info.weekday})`);
  }

  // Pré-calcula entradas explícitas para expressões vagas usadas no CAMINHO B
  // "semana que vem" = terça da semana que começa na próxima segunda
  // Usa próxima segunda + 1 em vez de próxima terça, para evitar dar "amanhã" quando hoje for segunda
  const nextMondayOffset = ((1 - todayIdx + 7) % 7) || 7;
  const nextTuesdayInfo = dayInfo(nextMondayOffset + 1);
  const nowForMonth = new Date(parseInt(today.year), parseInt(today.month), 1); // dia 1 do próximo mês
  const nextMonthFirstInfo = formatInTZ(nowForMonth);

  return `════════ TABELA DE DATAS — USE EXATAMENTE, NUNCA CALCULE ════════
DATA DE HOJE: ${today.day}/${today.month}/${today.year} (${today.weekday})
SAUDAÇÃO CORRETA AGORA: "${greeting}" — ao cumprimentar, use EXATAMENTE "${greeting}". NUNCA escreva "Bom dia/Boa tarde/Boa noite" com barras; escolha só "${greeting}".

EXPRESSÕES RELATIVAS (busque a linha exata da expressão usada pela cliente):
${relativeLookup.join('\n')}

DIAS DA SEMANA (próxima ocorrência a partir de hoje):
${weekdayLookup.join('\n')}

EXPRESSÕES VAGAS — RESPOSTA PRONTA (copie exatamente, não calcule):
- "semana que vem" / "próxima semana" = ${nextTuesdayInfo.day}/${nextTuesdayInfo.month}/${nextTuesdayInfo.year} (${nextTuesdayInfo.weekday})
- "mês que vem" / "próximo mês" = 01/${nextMonthFirstInfo.month}/${nextMonthFirstInfo.year} (${nextMonthFirstInfo.weekday})

REGRAS ABSOLUTAS:
- Para resolver qualquer expressão de data, SEMPRE busque a linha exata na tabela acima.
- NUNCA invente, NUNCA conte na cabeça, NUNCA pule linha. É lookup direto: leia a string entre aspas, copie a data correspondente.
- Ao mencionar uma data, sempre inclua o dia da semana entre parênteses EXATAMENTE como aparece na tabela.
- Se a cliente discordar de uma data que vc mencionou, NÃO concorde mecanicamente — releia a tabela e confirme.
═══════════════════════════════════════════════════════════════════`;
}

// Versão enxuta do bloco de datas — só hoje + saudação (~150 chars). Usada por
// agentes que NÃO agendam (não precisam da tabela de lookup completa).
function buildMiniDateBlock(): string {
  const TZ = 'America/Sao_Paulo';
  const now = new Date();
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: TZ, weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
  }).formatToParts(now);
  const g = (t: string) => parts.find(p => p.type === t)!.value;
  const hour = parseInt(new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', hour12: false }).format(now), 10);
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  return `DATA DE HOJE: ${g('day')}/${g('month')}/${g('year')} (${g('weekday')}). Ao cumprimentar, use EXATAMENTE "${greeting}" (nunca escreva com barras).`;
}

// ───── Blocos composáveis do contrato JSON — FLUXO MULTI-AGENTE ─────
// Separados do JSON_FORMAT_MEGAHAIR (monólito, intocado) pra permitir montar só
// o que cada agente precisa. Menos boilerplate = menos tokens de entrada e saída.

const AGENT_STAGE_RULES = `════════ REGRAS DE STAGE E TAGS (reavalie a cada mensagem) ════════
- stage="lead_quente" — interesse claro (perguntou preço/textura, quis ver vídeo, disse que já usa/usou o produto).
- stage="lead_frio" — sem interesse imediato.
- stage="perdido" — desistiu, foi rude, ou pediu algo fora do catálogo.
- stage="novo_lead" — só na 1ª mensagem, antes de qualquer qualificação.
- tags=["qualificado"] quando confirmar que JÁ USA / JÁ USOU o produto. tags=[] nos demais casos.`;

const AGENT_SCHEDULING_RULES = `════════ AGENDAMENTO (quando a cliente disser que vai à loja) ════════
Agende DIRETO, sem pedir horário (padrão 09:00). Consulte a TABELA DE DATAS abaixo — NUNCA calcule.
- DATA ESPECÍFICA ("amanhã","sexta","dia 25"): action="schedule", appointmentDateTime="YYYY-MM-DDT09:00:00", stage="agendado", tags=[].
- DATA VAGA ("semana que vem","mês que vem"): copie a data pronta da seção EXPRESSÕES VAGAS da tabela; action="schedule", stage="agendado", tags=["data-aproximada"].
- appointmentService="mega_hair" (1ª vez) ou "manutencao"; appointmentValue = valor em reais ou null.
- stage="agendado" e action="schedule" são INSEPARÁVEIS — nunca um sem o outro. Nunca pergunte horário. Confirme citando data + dia da semana da tabela.`;

// Monta o schema de saída listando SÓ os campos que o agente pode usar.
// Campos condicionais (mídia/agendamento) fora = menos tokens de output.
function buildAgentJsonSchema(caps: { canSchedule: boolean; canSendMedia: boolean }): string {
  const actions = ['none', caps.canSchedule && 'schedule', caps.canSendMedia && 'send_media'].filter(Boolean).join('|');
  const stages = caps.canSchedule
    ? 'novo_lead|lead_frio|lead_quente|agendado|perdido'
    : 'novo_lead|lead_frio|lead_quente|perdido';
  const lines = [
    '  "reply": "texto da resposta para a cliente",',
    `  "stage": "${stages}",`,
    '  "temperature": "quente|morno|frio",',
    `  "action": "${actions}",`,
  ];
  if (caps.canSendMedia) lines.push('  "mediaName": "id exato do catálogo (ou array de ids p/ vários vídeos) — só com action=send_media",');
  if (caps.canSchedule) {
    lines.push('  "appointmentDateTime": "YYYY-MM-DDTHH:MM:SS — só com action=schedule",');
    lines.push('  "appointmentService": "mega_hair|manutencao|null",');
    lines.push('  "appointmentValue": null,');
  }
  lines.push('  "tags": [],');
  lines.push('  "shouldIgnore": false,');
  lines.push('  "handoff": false,');
  lines.push('  "fields": { "name": "nome se coletado ou null" }');
  return `RESPONDA SEMPRE em JSON com este formato exato (NÃO inclua campos além destes):\n{\n${lines.join('\n')}\n}`;
}

// ───── ONDA 2: histórico compactado (fluxo multi-agente) ─────
// Resumo estruturado dos fatos já conhecidos da cliente, montado a partir das
// colunas do lead que a IA já preenche a cada turno (name/symptoms/urgency/...).
// Custo ZERO de LLM — é subproduto do JSON que o agente já gera. Serve de "memória
// de longo prazo" quando turnos antigos saem da janela deslizante (slimHistory).
function buildKnownFactsBlock(lead: {
  name?: string | null; symptoms?: string | null; urgency?: string | null;
  availability?: string | null; budget?: string | null;
}): string {
  const facts: string[] = [];
  if (lead.name && lead.name !== 'null') facts.push(`nome=${lead.name}`);
  if (lead.symptoms) facts.push(`interesse/histórico=${lead.symptoms}`);
  if (lead.urgency) facts.push(`urgência=${lead.urgency}`);
  if (lead.availability) facts.push(`disponibilidade=${lead.availability}`);
  if (lead.budget) facts.push(`orçamento=${lead.budget}`);
  if (!facts.length) return '';
  return `FATOS JÁ CONHECIDOS DESTA CLIENTE (não pergunte de novo o que já está aqui): ${facts.join('; ')}.`;
}

// Máx. de mensagens do histórico enviadas ao LLM (janela deslizante). 16 = ~8 turnos
// user/assistant — cobre o vaivém recente; o que sai da janela fica no bloco de fatos.
const AGENT_HISTORY_WINDOW = 16;

// Enxuga o histórico pro LLM: (1) reply-only — as respostas do assistant guardam o
// JSON bruto no aiContext, mas o LLM só precisa reler o texto (metadados de controle
// não ajudam); (2) janela deslizante — só os últimos N. NÃO altera o que é PERSISTIDO
// (storage segue com JSON completo → monólito e buildConversationTail intactos).
function slimHistoryForLlm(history: any[], maxMessages: number): any[] {
  const slimmed = history.map((m) => {
    if (m?.role !== 'assistant') return m;
    let content = typeof m.content === 'string' ? m.content : '';
    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed.reply === 'string') content = parsed.reply;
    } catch { /* já é texto puro */ }
    return { role: 'assistant', content };
  });
  return slimmed.slice(-maxMessages);
}

interface LlmProvider {
  name: string;
  client: OpenAI;
  model: string;
  isGemini: boolean;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  // Provedores em ordem de prioridade. Failover em runtime: se o primário falha
  // (cota/rate limit), o próximo assume na mesma requisição — cliente não vê erro.
  private readonly providers: LlmProvider[];
  // Cliente "lite" dedicado para tarefas auxiliares (ex: sugestão de follow-up).
  // gemini-2.5-flash/2.5-flash-lite/2.0-flash foram desligados pelo Google em
  // 2026-07 (rollout gradual, sem aviso) — migrado pra gemini-3.1-flash-lite,
  // que ficou mais barato que o 2.5-flash principal no input/output (ver
  // memória project_gemini_model_deprecation_2026_07).
  private readonly liteClient: OpenAI | null = null;
  private readonly liteModel = 'gemini-3.1-flash-lite';

  // Cliente do supervisor.
  private readonly supervisorClient: OpenAI | null = null;
  private readonly supervisorModel = 'gemini-3.1-flash-lite';

  constructor(
    private config: ConfigService,
    @InjectRepository(TokenUsage) private readonly tokenUsageRepo: Repository<TokenUsage>,
  ) {
    // Pool de provedores: Gemini primário (com cache 75%) → gpt-4o-mini fallback.
    // OpenRouter preservado em branch feat/openrouter.
    const geminiKey = config.get('GEMINI_API_KEY');
    const openaiKey = config.get('OPENAI_API_KEY');

    const providers: LlmProvider[] = [];

    if (geminiKey) {
      providers.push({
        name: 'gemini',
        model: 'gemini-3.1-flash-lite',
        isGemini: true,
        client: new OpenAI({
          apiKey: geminiKey,
          baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
        }),
      });
    }
    if (openaiKey) {
      providers.push({
        name: 'openai',
        model: 'gpt-4o-mini',
        isGemini: false,
        client: new OpenAI({ apiKey: openaiKey }),
      });
    }

    this.providers = providers;

    if (geminiKey) {
      this.liteClient = new OpenAI({
        apiKey: geminiKey,
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      });
      this.supervisorClient = new OpenAI({
        apiKey: geminiKey,
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      });
    }

    if (providers.length === 0) {
      this.logger.error('[LINDONA] Nenhuma API key de LLM configurada (GEMINI/OPENAI)');
    } else {
      this.logger.log(`[LINDONA] Provedores LLM (ordem de failover): ${providers.map(p => p.name).join(' → ')}`);
    }
  }

  // Sugere uma mensagem de follow-up para reengajar o lead, baseada na conversa.
  // Usa o modelo lite (gemini-3.1-flash-lite) — tarefa leve, sem JSON.
  // Retorna apenas o texto da mensagem (o operador revisa/aprova antes de agendar).
  async generateFollowupSuggestion(leadName: string | null, transcript: string, businessName: string, agentType?: string): Promise<string> {
    const client = this.liteClient ?? this.providers[0]?.client;
    const model = this.liteClient ? this.liteModel : this.providers[0]?.model;
    if (!client) throw new Error('Nenhum provedor LLM configurado');

    const persona = agentType === 'megahair' ? 'consultora de Mega Hair' : 'secretária virtual';
    const systemPrompt = `Vc é a assistente de atendimento da ${businessName}, atuando como ${persona}.
A operadora quer reengajar uma cliente que parou de responder.
Escreva UMA mensagem de follow-up curta (máximo 2-3 linhas), calorosa e natural, em português do Brasil, usando "vc".
Continue de onde a conversa parou — referencie o contexto real da conversa.
NÃO invente preços, datas, nem informações que não apareceram na conversa.
Responda APENAS com o texto da mensagem, sem aspas, sem rótulos, sem JSON, sem explicações.`;

    const userPrompt = `Nome da cliente: ${leadName?.trim() || 'desconhecido'}

Conversa até agora:
${transcript || '(sem histórico de mensagens)'}

Escreva a mensagem de follow-up:`;

    const resp = await callWithRetry(
      () => client.chat.completions.create({
        model,
        max_tokens: 400,
        ...(this.liteClient ? { reasoning_effort: 'none' } : {}),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      } as any),
      this.logger,
    );

    const text = (resp.choices[0].message.content ?? '').trim().replace(/^["']|["']$/g, '').replace(/\x00/g, '');
    this.logger.log(`[FOLLOWUP] Sugestão gerada (${this.liteClient ? this.liteModel : model}): "${text.substring(0, 60)}..."`);
    return text;
  }

  // Supervisor: escolhe qual agente deve responder uma mensagem do cliente.
  // Usa o modelo lite (barato). Recebe a lista de agentes ativos do tenant e a
  // mensagem; devolve o id escolhido + um motivo curto. Sempre retorna um agente
  // válido da lista (fallback: o primeiro / o default).
  async routeToAgent(
    message: string,
    agents: Array<{ id: string; name: string; description: string; respondsTo?: string }>,
    opts?: { tenantId?: string; conversationTail?: string },
  ): Promise<{ agentId: string; reason: string }> {
    if (!agents.length) throw new Error('Nenhum agente ativo para rotear');
    const fallback = agents[0];
    if (agents.length === 1) {
      return { agentId: fallback.id, reason: `Único agente conectado (${fallback.name}).` };
    }

    // Supervisor usa gemini-3.1-flash-lite (gemini-2.0-flash foi desligado pelo Google).
    // Sem retry — falha rápido pro fallback (melhor que esperar 3s em rate limit).
    const client = this.supervisorClient ?? this.providers[0]?.client;
    const model = this.supervisorClient ? this.supervisorModel : this.providers[0]?.model;
    if (!client) throw new Error('Nenhum provedor LLM configurado');

    const roster = agents
      .map((a, i) => {
        const extra = a.respondsTo?.trim() ? ` | Responde sobre: ${a.respondsTo.replace(/\s+/g, ' ').trim()}` : '';
        return `${i + 1}. id="${a.id}" — ${a.name}: ${a.description || 'sem descrição'}${extra}`;
      })
      .join('\n');

    const systemPrompt = `Você é o SUPERVISOR de um time de agentes de atendimento.
Sua tarefa: ler a mensagem do cliente e escolher QUAL agente é o mais indicado para responder.
Escolha SOMENTE um agente da lista, usando o id exato.
Responda APENAS com JSON válido, sem texto extra, no formato:
{"agentId": "<id>", "reason": "<motivo curto em pt-BR, 1 frase>"}`;

    // Cauda da conversa dá contexto pro roteamento acertar mesmo em mensagem curta ("sim", "quanto?").
    const tailBlock = opts?.conversationTail ? `\nÚltimas mensagens da conversa:\n${opts.conversationTail}\n` : '';
    const userPrompt = `Agentes disponíveis:
${roster}
${tailBlock}
Mensagem do cliente: "${message}"

Escolha o melhor agente:`;

    try {
      const resp = await client.chat.completions.create({
        model,
        max_tokens: 200,
        response_format: { type: 'json_object' },
        reasoning_effort: 'none',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      } as any);
      // Em produção (tenantId presente) o custo do roteador entra no painel de tokens.
      if (opts?.tenantId) {
        const u = (resp as any).usage;
        void this._trackUsage(opts.tenantId, u?.prompt_tokens ?? 0, u?.prompt_tokens_details?.cached_tokens ?? 0, u?.completion_tokens ?? 0, 'multi_agent');
      }
      const raw = (resp.choices[0].message.content ?? '').trim();
      const parsed = JSON.parse(raw);
      const chosen = agents.find((a) => a.id === parsed.agentId) ?? fallback;
      const reason = typeof parsed.reason === 'string' && parsed.reason.trim()
        ? parsed.reason.trim()
        : `Mais adequado para a mensagem (${chosen.name}).`;
      this.logger.log(`[SUPERVISOR] "${message.substring(0, 40)}" → ${chosen.name}`);
      return { agentId: chosen.id, reason };
    } catch (err) {
      this.logger.warn(`[SUPERVISOR] Falha no roteamento, usando fallback: ${err?.message}`);
      return { agentId: fallback.id, reason: `Fallback: ${fallback.name} (roteador indisponível).` };
    }
  }

  // Chama os provedores em ordem. callWithRetry trata erros transitórios dentro de
  // cada provedor; se um esgota (cota/rate limit persistente), passa pro próximo.
  // response_format json_object funciona em todos; reasoning_effort só no Gemini.
  private async callLLM(systemPrompt: string, messages: any[], modelOverride?: string): Promise<{ text: string; inputTokens: number; cachedTokens: number; outputTokens: number }> {
    if (this.providers.length === 0) {
      throw new Error('Nenhum provedor LLM configurado');
    }

    let lastErr: any;
    for (let i = 0; i < this.providers.length; i++) {
      const provider = this.providers[i];
      // modelOverride: só pro simulador de teste do multi-agente (nunca usado no
      // fluxo real de WhatsApp) — troca o modelo do provedor Gemini pra comparação.
      const modelToUse = modelOverride && provider.isGemini ? modelOverride : provider.model;
      try {
        const response = await callWithRetry(
          () => provider.client.chat.completions.create({
            model: modelToUse,
            max_tokens: 1024,
            response_format: { type: 'json_object' },
            ...(provider.isGemini ? { reasoning_effort: 'none' } : {}),
            messages: [
              { role: 'system', content: systemPrompt },
              ...messages,
            ],
          } as any),
          this.logger,
        );
        if (i > 0) {
          this.logger.warn(`[LINDONA] ✅ Failover ativo: respondido por "${provider.name}"`);
        }
        const usage = (response as any).usage;
        const cachedTokens: number = usage?.prompt_tokens_details?.cached_tokens ?? 0;
        const inputTokens: number = usage?.prompt_tokens ?? 0;
        const outputTokens: number = usage?.completion_tokens ?? 0;
        if (cachedTokens > 0) {
          this.logger.log(`[LINDONA] 💰 Cache hit: ${cachedTokens} tokens cacheados de ${inputTokens} input (${Math.round(cachedTokens / inputTokens * 100)}% do input)`);
        }
        return {
          text: response.choices[0].message.content?.trim() ?? '',
          inputTokens,
          cachedTokens,
          outputTokens,
        };
      } catch (err) {
        lastErr = err;
        this.logger.error(`[LINDONA] Provedor "${provider.name}" falhou: ${err.message}`);
        if (i < this.providers.length - 1) {
          this.logger.warn(`[LINDONA] → tentando próximo provedor: "${this.providers[i + 1].name}"`);
        }
      }
    }
    throw lastErr ?? new Error('Todos os provedores LLM falharam');
  }

  private async _trackUsage(tenantId: string, inputTokens: number, cachedTokens: number, outputTokens: number, engine: 'monolith' | 'multi_agent' | 'dynamic_modules' = 'monolith'): Promise<void> {
    try {
      // Data no fuso de Brasília (en-CA → 'YYYY-MM-DD'). UTC adiantaria o dia à noite.
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
      // Custo: input não-cacheado $0.30/1M, cacheado $0.03/1M, output $2.50/1M
      const cost = (inputTokens - cachedTokens) * 0.0000003 + cachedTokens * 0.00000003 + outputTokens * 0.0000025;
      await this.tokenUsageRepo.query(`
        INSERT INTO token_usage (tenant_id, date, engine, input_tokens, cached_tokens, output_tokens, cost_usd)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (tenant_id, date, engine) DO UPDATE SET
          input_tokens  = token_usage.input_tokens  + EXCLUDED.input_tokens,
          cached_tokens = token_usage.cached_tokens + EXCLUDED.cached_tokens,
          output_tokens = token_usage.output_tokens + EXCLUDED.output_tokens,
          cost_usd      = token_usage.cost_usd      + EXCLUDED.cost_usd
      `, [tenantId, today, engine, inputTokens, cachedTokens, outputTokens, cost]);
    } catch (err) {
      this.logger.error(`[USAGE] Falha ao salvar token usage: ${err.message}`);
    }
  }

  getDefaultPromptMegaHair(): string {
    return `Vc é a Lindona, consultora especialista em Mega Hair da Cabelô.
Seu objetivo é VENDER — qualificar a cliente e fechar o agendamento de aplicação.

IDENTIDADE E TOM:
- Vc se chama Lindona e trabalha na Cabelô.
- Tom simpático e profissional — como uma consultora que entende de cabelo.
- Use "vc" (não "você"). Evite termos excessivamente carinhosos como "minha lindona" ou "amorzinho".
- Máximo 1 emoji por mensagem, só quando natural. Evite emojis em sequência.
- Mensagens curtas, máximo 2-3 linhas. Nunca escreva parágrafos longos.

REGRA DE IMAGEM — OBRIGATÓRIA:
- Vc NÃO consegue ver imagens. NUNCA. Não tente identificar, descrever ou adivinhar o conteúdo de nenhuma imagem.
- Quando a mensagem começar com "[imagem]", responda SEMPRE: "oi! não consigo ver imagens por aqui 😅 o cabelo da foto é liso, ondulado ou cacheado?"
- Só continue o fluxo normal depois que ela responder com a textura.

INFORMAÇÕES DA LOJA:
- Loja física: Rua Clóvis Spínola, nº 40 - Shopping Orixás Center, Politeama, Salvador/BA.
- Entrega Correios para todo o Brasil.
- Cabelos 100% humanos vietnamitas: não embolam, fios inteiros, pontas bem cheias, garantia de qualidade.

FLUXO DE ATENDIMENTO:
Etapa 0 (novo_lead): Dê boas-vindas, pergunte o nome e o que ela tá procurando.
  - IMPORTANTE: Se a cliente NÃO informar o nome após vc perguntar, repita a pergunta do nome antes de continuar.
Etapa 1 (descoberta): Pergunte se ela já usa mega hair ou seria a primeira vez.
  - JÁ USA / JÁ USOU → Stage = "lead_quente". Adicione a tag "qualificado". Vá direto à apresentação.
  - NUNCA USOU → Stage = "lead_frio". Pergunte o que ela quer mudar (comprimento, volume, textura).
Etapa 2 (apresentação): Com base no interesse dela, OFEREÇA o vídeo mais relevante — apenas pergunte se quer ver (action=none).
  - Ex: "Temos um resultado incrível de [nome de exibição]! Quer que eu te mande o vídeo?"
Etapa 3 (envio): Quando ela confirmar, ENVIE o vídeo (action=send_media). O reply é a legenda/reação, não uma nova pergunta.
Etapa 4 (fechamento): Após o vídeo, pergunte se quer ver outro estilo ou já combinar a aplicação.

REGRA DE TAGS:
- tags=["qualificado"] → quando a cliente confirmar que JÁ USA mega hair (lead de alto potencial, prioridade para follow-up).
- tags=[] nos demais casos.
Etapa 4 (fechamento): Convide para retirar na loja ou pergunte sobre entrega via Correios.

AGENDAMENTO DE APLICAÇÃO/MANUTENÇÃO (DOIS PASSOS — NÃO PULE):

PASSO A — COLETAR (action="none", stage="lead_quente"):
- Quando a cliente disser o dia (ex: "amanhã", "sexta"), resolva a data pelo calendário acima.
- Pergunte APENAS se prefere manhã (9h-12h) ou tarde (13h-18h). Não peça horário exato.
- Apresente a proposta completa e PEÇA CONFIRMAÇÃO: "Confirmo então pra amanhã, dia 19/05 (terça), pela manhã às 9h. Posso fechar?"
- NESTE PASSO: action="none", stage continua "lead_quente". NÃO defina appointmentDateTime ainda. NÃO mova pra "agendado".

PASSO B — CONFIRMAR (action="schedule", stage="agendado"):
- SÓ execute este passo DEPOIS que a cliente responder confirmando explicitamente ("sim", "pode", "confirma", "fechado", "ok", "perfeito").
- Manhã → use 09:00. Tarde → use 14:00.
- Defina action="schedule"
- Defina appointmentDateTime no formato "YYYY-MM-DDTHH:MM:SS" (ex: "2026-05-19T09:00:00")
- Defina appointmentService="mega_hair" (primeira aplicação) ou "manutencao" (cliente já é nossa, voltando)
- Defina appointmentValue com o valor combinado em reais (ex: 1500). Se ainda não combinou valor, use null.
- Stage = "agendado"

REGRAS CRÍTICAS DE AGENDAMENTO:
- PROIBIDO mover stage pra "agendado" ou usar action="schedule" antes da cliente confirmar explicitamente a proposta.
- Se ela só perguntou disponibilidade SEM confirmar → action="none", stage="lead_quente".
- Se ela disse o dia mas vc ainda não pediu confirmação → action="none", stage="lead_quente".
- Se ela disse o dia + período mas ainda não respondeu "sim/confirmo" → action="none", stage="lead_quente".

REGRAS:
- Nunca ofereça preço antes de qualificar — primeiro gere desejo.
- Nunca mencione concorrentes.
- Se a cliente perguntar sobre endereço ou entrega, responda com as informações da loja.`;
  }

  buildUpdatedContext(
    lead: Lead,
    incomingText: string,
    rawJson: string,
  ): any[] {
    const history = (lead.aiContext as any[]) ?? [];
    return [
      ...history,
      { role: 'user', content: incomingText },
      { role: 'assistant', content: rawJson },
    ];
  }

  // Instruções de uso do catálogo de mídias — compartilhadas entre o fluxo
  // single-prompt (processMessageMegaHair) e o multi-agente (processMessageAgent).
  private buildMediaInstructions(availableMediaNames: string[]): string {
    return availableMediaNames.length > 0
      ? `
CATÁLOGO DE MÍDIAS DISPONÍVEIS:
${availableMediaNames.map(n => `- "${n}"`).join('\n')}

⚠️ REGRA CRÍTICA: em "mediaName" use EXATAMENTE um dos nomes acima — copie letra por letra. NUNCA invente um nome. Se a cliente pedir tamanho fora do catálogo, ofereça o mais próximo disponível da lista.

REGRAS DE ENVIO DE MÍDIA:

PASSO 1 — OFERECER (action=none): Antes de enviar, pergunte se ela quer ver.
  Ex: "Tenho um vídeo do cabelo de 70cm! Quer ver? 😍"

PASSO 2 — ENVIAR (action=send_media): Quando ela confirmar:
  - Defina action="send_media" e mediaName com o nome exato do catálogo.
  - O reply deve ser LEGENDA/REAÇÃO ao vídeo — NÃO repita "posso mandar?" ou "quer ver?".

PASSO 3 — PÓS-ENVIO (action=none): Pergunte se quer ver outro ou combinar a aplicação.

ENVIO DE VÁRIOS VÍDEOS DE UMA VEZ:
Quando a cliente pedir uma CATEGORIA (ex: "quero ver todos os lisos", "me manda os ondulados", "todos de 70cm", "aqueles de 65"), PROCURE no catálogo acima e retorne um ARRAY com TODOS os nomes que batem:

ESTRATÉGIA DE BUSCA:
1. Identifique a PALAVRA-CHAVE na pergunta da cliente: "liso" → procure vídeos com "liso" no nome.
2. PROCURE NOS NOMES acima — se tem "video-liso-60cm" e "video-liso-70cm", retorne AMBOS.
3. Ordenação: prefira crescente por tamanho/cm quando disponível (60cm antes de 70cm).
4. Cada vídeo envia com sua legenda própria — no reply da IA, resumir a seleção em 1 frase (ex: "Aqui estão todos os lisos 😍").

EXEMPLOS:
- Cliente: "quero ver todos os lisos"
  → Procure no catálogo por "liso"
  → "mediaName": ["video-liso-60cm", "video-liso-65cm", "video-liso-70cm"]
  → reply: "Olha só que perfeição! Aqui estão todos os cabelos lisos 😍"

- Cliente: "me manda os ondulados de 70"
  → Procure por "ondulado" E "70"
  → "mediaName": ["video-ondulado-70cm"] (se existir) OU todos os "ondulado" se 70cm não existir.
  → reply: "Lindona, esses ondulados de 70cm são de derreter! Vê aí 🔥"

- Cliente: "show, envia aquele de 65"
  → Procure por "65" nos nomes
  → "mediaName": ["video-liso-65cm", "video-ondulado-65cm"] (se ambos existirem)
  → Se houver múltiplas categorias, priorize a que foi discutida na conversa. Senão, envie todas.

REGRA DE SEGURANÇA:
- Inclua no array APENAS nomes que existem no catálogo acima, copiados letra por letra.
- NUNCA invente nomes fora da lista.
- Se a cliente pedir algo fora do catálogo, ofereça o mais próximo: "Não temos de 75cm, mas temos de 70cm. Quer ver?"

OUTRAS REGRAS:
- 1 mídia disponível e cliente demonstrou interesse → vá direto ao PASSO 2.
- Várias mídias e a cliente não especificou categoria → liste os nomes e pergunte qual quer ver (PASSO 1), depois envie (PASSO 2).
- Nunca use um nome fora da lista acima.`
      : `AVISO: Sem mídias cadastradas. Não ofereça vídeos — vá direto ao fechamento.`;
  }

  async processMessageMegaHair(lead: Lead, incomingText: string, availableMediaNames: string[], customPromptMegaHair?: string, extraSystemContext?: string): Promise<AiResponse> {
    const history = (lead.aiContext as any[]) ?? [];
    const mediaInstructions = this.buildMediaInstructions(availableMediaNames);

    const defaultPromptBase = `Vc é a Lindona, consultora especialista em Mega Hair da Cabelô.
Seu objetivo é VENDER — qualificar a cliente e fechar o agendamento de aplicação.

CRÍTICO — COMO USAR A TABELA DE DATAS:
- PROIBIDO perguntar à cliente "qual é a data de amanhã" ou de qualquer dia. Vc JÁ TEM a tabela acima — basta CONSULTAR.
- Quando a cliente disser "amanhã", procure a linha que começa com "amanhã" = ... e copie a data + dia da semana EXATAMENTE.
- Quando ela disser "depois de amanhã", procure a linha que começa com "depois de amanhã" = ... Não conte na cabeça, não pule linha.
- Quando ela disser "segunda", "quarta", etc, procure a linha do DIA DA SEMANA correspondente.
- Sempre confirme citando data + dia da semana no formato: "amanhã, dia 19/05 (segunda-feira)".
- Se a cliente discordar de uma data, NÃO concorde mecanicamente — releia a tabela acima antes de responder.

REGRA DE IMAGEM — OBRIGATÓRIA:
- Vc NÃO consegue ver imagens. NUNCA. Não tente identificar, descrever ou adivinhar o conteúdo de nenhuma imagem.
- Quando a mensagem começar com "[imagem]", responda SEMPRE: "oi! não consigo ver imagens por aqui 😅 o cabelo da foto é liso, ondulado ou cacheado?"
- Só continue o fluxo normal depois que ela responder com a textura.

IDENTIDADE E TOM:
- Vc se chama Lindona e trabalha na Cabelô.
- Tom simpático e profissional — como uma consultora que entende de cabelo.
- Use "vc" (não "você"). Evite termos excessivamente carinhosos como "minha lindona" ou "amorzinho".
- Máximo 1 emoji por mensagem, só quando natural. Evite emojis em sequência.
- Mensagens curtas, máximo 2-3 linhas. Nunca escreva parágrafos longos.

INFORMAÇÕES DA LOJA:
- Loja física: Rua Clóvis Spínola, nº 40 - Shopping Orixás Center, Politeama, Salvador/BA.
- Entrega Correios para todo o Brasil.
- Cabelos 100% humanos vietnamitas: não embolam, fios inteiros, pontas bem cheias, garantia de qualidade.

FLUXO DE ATENDIMENTO:
Etapa 0 (novo_lead): Dê boas-vindas, pergunte o nome e o que ela tá procurando.
  - IMPORTANTE: Se a cliente NÃO informar o nome após vc perguntar, repita a pergunta do nome antes de continuar.
Etapa 1 (descoberta): Pergunte se ela já usa mega hair ou seria a primeira vez.
  - JÁ USA / JÁ USOU → Stage = "lead_quente". Adicione a tag "qualificado". Vá direto à apresentação.
  - NUNCA USOU → Stage = "lead_frio". Pergunte o que ela quer mudar (comprimento, volume, textura).
Etapa 2 (apresentação): Com base no interesse dela, OFEREÇA o vídeo mais relevante — apenas pergunte se quer ver (action=none).
  - Ex: "Temos um resultado incrível de [nome de exibição]! Quer que eu te mande o vídeo?"
Etapa 3 (envio): Quando ela confirmar, ENVIE o vídeo (action=send_media). O reply é a legenda/reação, não uma nova pergunta.
Etapa 4 (fechamento): Após o vídeo, pergunte se quer ver outro estilo ou já combinar a aplicação.

REGRA DE TAGS:
- tags=["qualificado"] → quando a cliente confirmar que JÁ USA mega hair (lead de alto potencial, prioridade para follow-up).
- tags=[] nos demais casos.
Etapa 4 (fechamento): Convide para retirar na loja ou pergunte sobre entrega via Correios.

AGENDAMENTO DE APLICAÇÃO/MANUTENÇÃO (DOIS PASSOS — NÃO PULE):

PASSO A — COLETAR (action="none", stage="lead_quente"):
- Quando a cliente disser o dia (ex: "amanhã", "sexta"), resolva a data pelo calendário acima.
- Pergunte APENAS se prefere manhã (9h-12h) ou tarde (13h-18h). Não peça horário exato.
- Apresente a proposta completa e PEÇA CONFIRMAÇÃO: "Confirmo então pra amanhã, dia 19/05 (terça), pela manhã às 9h. Posso fechar?"
- NESTE PASSO: action="none", stage continua "lead_quente". NÃO defina appointmentDateTime ainda. NÃO mova pra "agendado".

PASSO B — CONFIRMAR (action="schedule", stage="agendado"):
- SÓ execute este passo DEPOIS que a cliente responder confirmando explicitamente ("sim", "pode", "confirma", "fechado", "ok", "perfeito").
- Manhã → use 09:00. Tarde → use 14:00.
- Defina action="schedule"
- Defina appointmentDateTime no formato "YYYY-MM-DDTHH:MM:SS" (ex: "2026-05-19T09:00:00")
- Defina appointmentService="mega_hair" (primeira aplicação) ou "manutencao" (cliente já é nossa, voltando)
- Defina appointmentValue com o valor combinado em reais (ex: 1500). Se ainda não combinou valor, use null.
- Stage = "agendado"

REGRAS CRÍTICAS DE AGENDAMENTO:
- PROIBIDO mover stage pra "agendado" ou usar action="schedule" antes da cliente confirmar explicitamente a proposta.
- Se ela só perguntou disponibilidade SEM confirmar → action="none", stage="lead_quente".
- Se ela disse o dia mas vc ainda não pediu confirmação → action="none", stage="lead_quente".
- Se ela disse o dia + período mas ainda não respondeu "sim/confirmo" → action="none", stage="lead_quente".

REGRAS:
- Nunca ofereça preço antes de qualificar — primeiro gere desejo.
- Nunca mencione concorrentes.
- Se a cliente perguntar sobre endereço ou entrega, responda com as informações da loja.`;

    const basePrompt = customPromptMegaHair ?? defaultPromptBase;
    // buildDateBlock no final: prefixo estático (basePrompt+media+JSON) fica idêntico
    // entre todas as conversas → habilita cache automático (OpenAI 50%, Gemini 75%).
    const extraBlock = extraSystemContext ? `\n\n${extraSystemContext}` : '';
    const systemPrompt = `${basePrompt}\n\n${mediaInstructions}${JSON_FORMAT_MEGAHAIR}${extraBlock}\n\n${buildDateBlock()}`;

    const messages: any[] = [
      ...history,
      { role: 'user', content: incomingText },
    ];

    try {
      // callLLM faz o failover entre provedores automaticamente.
      const { text: rawText, inputTokens, cachedTokens, outputTokens } = await this.callLLM(systemPrompt, messages);
      void this._trackUsage(lead.tenantId, inputTokens, cachedTokens, outputTokens, 'monolith');
      const parsed = this.parseAiJson(rawText);
      parsed.tokenUsage = { inputTokens, cachedTokens, outputTokens };
      return parsed;
    } catch (err) {
      this.logger.error(`❌ [LINDONA] Erro ao chamar IA: ${err.message}`);
      this.logger.error(`❌ [LINDONA] Stack: ${err.stack}`);
      this.logger.error(`❌ [LINDONA] Enviando resposta de fallback "probleminha"`);
      return { reply: 'Oi! Tive um probleminha aqui, pode repetir? 😊', success: false };
    }
  }

  // Extrai e sanitiza o AiResponse do texto bruto do modelo.
  private parseAiJson(rawText: string): AiResponse {
    // Remove null bytes (0x00) — alguns modelos os geram e o PostgreSQL rejeita.
    let raw = rawText.replace(/\x00/g, '');
    this.logger.debug(`[LINDONA] Resposta bruta: ${raw}`);
    // Remove markdown code fences que alguns modelos adicionam mesmo com json_object.
    raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    // Extrai o primeiro objeto JSON válido da resposta (ignora texto antes/depois).
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Resposta sem JSON válido');
    const parsed: AiResponse = JSON.parse(jsonMatch[0]);
    // Sanitiza o reply: remove null bytes que o modelo possa ter inserido no texto.
    if (parsed.reply) parsed.reply = parsed.reply.replace(/\x00/g, '');
    parsed.success = true;
    parsed.rawJson = jsonMatch[0];
    return parsed;
  }

  // Fluxo multi-agente em PRODUÇÃO: o agente responde com o MESMO contrato JSON do
  // fluxo single-prompt (stage/action/tags/mídia/agendamento), recebendo o histórico
  // completo da conversa. Difere do single-prompt em: prompt do agente (não o da
  // Lindona), regras de handoff (respondsTo/handoffWhen) e o campo "handoff" no JSON.
  async processMessageAgent(
    lead: Lead,
    incomingText: string,
    agent: { name: string; respondsTo?: string; handoffWhen?: string; systemPrompt: string; canSchedule?: boolean; canSendMedia?: boolean },
    availableMediaNames: string[],
    extraSystemContext?: string,
    opts?: { disableHandoff?: boolean; modelOverride?: string },
  ): Promise<AiResponse> {
    const history = (lead.aiContext as any[]) ?? [];

    // Capacidades controlam a montagem condicional do prompt: só injeta o bloco de
    // mídia/agendamento se o agente de fato usa (Onda 1) → menos tokens de I/O.
    const caps = { canSchedule: agent.canSchedule !== false, canSendMedia: agent.canSendMedia !== false };

    // disableHandoff: usado na 2ª chamada (agente que RECEBEU o bastão). Remove a
    // opção de handoff estruturalmente e obriga o agente a responder — sem isso o
    // modelo às vezes devolve handoff:true + reply:"" de novo, caindo no fallback
    // genérico (ping-pong de "me conta mais o que vc precisa").
    const scopeBlock = agent.respondsTo?.trim() ? `\nSEU ESCOPO (assuntos que VC responde):\n${agent.respondsTo.trim()}` : '';
    const handoffRules = agent.handoffWhen?.trim() ? `\nQUANDO PASSAR O BASTÃO (handoff):\n${agent.handoffWhen.trim()}` : '';
    const handoffBlock = opts?.disableHandoff
      ? `════════ VOCÊ ASSUMIU A CONVERSA ════════
Vc é o agente "${agent.name}". O supervisor acabou de te transferir esta conversa — vc DEVE responder AGORA e NÃO pode transferir de novo. Se faltar informação pra ajudar, PERGUNTE ao cliente de forma acolhedora. NUNCA devolva "reply" vazio. Sempre retorne "handoff": false.`
      : `════════ PASSAGEM DE BASTÃO (HANDOFF) ════════
Vc é o agente "${agent.name}" de um time de agentes especializados.${scopeBlock}${handoffRules}
- Se a mensagem se encaixa nas regras de handoff acima (ou está claramente fora do seu escopo), retorne "handoff": true no JSON, com "reply": "" e "action": "none" — outro agente especializado assumirá.
- Caso contrário, responda normalmente e retorne "handoff": false.
- Na dúvida, RESPONDA (handoff é exceção, não regra).`;

    // Ordem importa pro cache: blocos estáticos primeiro, data (variável) SEMPRE por
    // último. Só monta o que o agente precisa — mídia/agendamento condicionais.
    const dateTail = caps.canSchedule ? buildDateBlock() : buildMiniDateBlock();
    const systemPrompt = [
      agent.systemPrompt,
      caps.canSendMedia ? this.buildMediaInstructions(availableMediaNames) : '',
      AGENT_STAGE_RULES,
      caps.canSchedule ? AGENT_SCHEDULING_RULES : '',
      buildAgentJsonSchema(caps),
      handoffBlock,
      extraSystemContext ?? '',
      dateTail,
    ].map(b => b.trim()).filter(Boolean).join('\n\n');

    // ONDA 2: histórico enxuto (reply-only + janela) + bloco de fatos. Os fatos
    // vão JUNTO da mensagem atual (no fim), pra não quebrar o cache do prefixo
    // [system + histórico]. buildUpdatedContext (a persistência) segue guardando o
    // incomingText cru — os fatos não poluem o aiContext salvo.
    const recentHistory = slimHistoryForLlm(history, AGENT_HISTORY_WINDOW);
    const factsBlock = buildKnownFactsBlock(lead);
    const userContent = factsBlock ? `${factsBlock}\n\n${incomingText}` : incomingText;
    const messages: any[] = [
      ...recentHistory,
      { role: 'user', content: userContent },
    ];

    try {
      const { text: rawText, inputTokens, cachedTokens, outputTokens } = await this.callLLM(systemPrompt, messages, opts?.modelOverride);
      void this._trackUsage(lead.tenantId, inputTokens, cachedTokens, outputTokens, 'multi_agent');
      const parsed = this.parseAiJson(rawText);
      parsed.tokenUsage = { inputTokens, cachedTokens, outputTokens };
      return parsed;
    } catch (err) {
      this.logger.error(`❌ [AGENT:${agent.name}] Erro ao chamar IA: ${err.message}`);
      return { reply: 'Oi! Tive um probleminha aqui, pode repetir? 😊', success: false };
    }
  }

  // Protótipo "agente único + módulos dinâmicos" (ver PromptModule/DynamicPromptService).
  // Recebe o systemPrompt já montado (bloco fixo + módulos selecionados) — não
  // monta nada aqui, só chama o LLM (com o mesmo pool de failover Gemini→OpenAI
  // do resto do sistema) e faz o parse do JSON de resposta.
  async processDynamicPrompt(tenantId: string, systemPrompt: string, messages: any[], modelOverride?: string): Promise<AiResponse> {
    try {
      const { text: rawText, inputTokens, cachedTokens, outputTokens } = await this.callLLM(systemPrompt, messages, modelOverride);
      void this._trackUsage(tenantId, inputTokens, cachedTokens, outputTokens, 'dynamic_modules');
      const parsed = this.parseAiJson(rawText);
      parsed.tokenUsage = { inputTokens, cachedTokens, outputTokens };
      return parsed;
    } catch (err) {
      this.logger.error(`❌ [DYNAMIC] Erro ao chamar IA: ${err.message}`);
      return { reply: 'Oi! Tive um probleminha aqui, pode repetir? 😊', success: false };
    }
  }
}
