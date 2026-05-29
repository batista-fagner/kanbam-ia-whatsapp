import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { Lead } from '../common/entities/lead.entity';

export interface AiResponse {
  reply: string;
  success?: boolean;
  rawJson?: string;
  stage?: string;
  temperature?: string;
  action?: 'schedule' | 'cancel' | 'reschedule' | 'send_media' | 'none';
  mediaName?: string; // nome da mídia cadastrada no sistema (quando action='send_media')
  appointmentDateTime?: string; // ISO 8601: "2026-03-28T09:00:00"
  appointmentService?: 'mega_hair' | 'manutencao' | null; // MegaHair: tipo do serviço
  appointmentValue?: number | null; // MegaHair: valor em reais
  tags?: string[]; // Tags para marcar lead como inativo, desrespeitoso, etc
  shouldIgnore?: boolean; // Se true, não responder mais mensagens deste lead
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
  "mediaName": "id-exato-ou-null",
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

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly client: OpenAI;
  private readonly chatModel: string;

  constructor(private config: ConfigService) {
    const geminiKey = config.get('GEMINI_API_KEY');
    const groqKey   = config.get('GROQ_API_KEY');

    if (geminiKey) {
      this.chatModel = 'gemini-2.5-flash';
      this.client = new OpenAI({
        apiKey: geminiKey,
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      });
    } else if (groqKey) {
      this.chatModel = 'llama-3.1-8b-instant';
      this.client = new OpenAI({
        apiKey: groqKey,
        baseURL: 'https://api.groq.com/openai/v1',
      });
    } else {
      this.chatModel = 'gpt-4o-mini';
      this.client = new OpenAI({ apiKey: config.get('OPENAI_API_KEY') });
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

  async processMessageMegaHair(lead: Lead, incomingText: string, availableMediaNames: string[], customPromptMegaHair?: string, extraSystemContext?: string): Promise<AiResponse> {
    const history = (lead.aiContext as any[]) ?? [];

    // Formata nome para exibição: "vietnamita-01" → "Vietnamita", "cacheado-60cm" → "Cacheado 60cm"
    const formatDisplay = (name: string) =>
      name.split(/[-_]/)
        .filter(part => !/^\d+$/.test(part))
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');

    const mediaEntries = availableMediaNames.map(n => ({
      original: n,
      display: formatDisplay(n),
    }));

    const mediaInstructions = mediaEntries.length > 0
      ? `
CATÁLOGO DE MÍDIAS DISPONÍVEIS (nome de exibição → id exato):
${mediaEntries.map(m => `- ${m.display} → "${m.original}"`).join('\n')}

REGRAS DE ENVIO DE MÍDIA — LEIA COM ATENÇÃO:

PASSO 1 — OFERECER (action=none): Antes de enviar, pergunte se ela quer ver.
  Ex: "Tenho um vídeo lindo do [nome de exibição] pra te mostrar! Quer ver? 😍"

PASSO 2 — ENVIAR (action=send_media): Quando ela disser "sim", "quero", "manda", etc:
  - Defina action="send_media" e mediaName com o id exato.
  - O reply deve ser LEGENDA/REAÇÃO ao vídeo sendo enviado agora — NÃO repita a pergunta "posso mandar?".
  - Ex de reply correto: "Olha que resultado lindo! 😍✨" ou "Esse é o [nome], viu como fica perfeito? 💖"
  - NUNCA escreva no reply "posso te mandar" ou "quer ver" quando action=send_media — o vídeo JÁ está sendo enviado.

PASSO 3 — PÓS-ENVIO (próxima resposta, action=none): Pergunte se quer ver outro tipo ou combinar a aplicação.

OUTRAS REGRAS:
- Se há apenas 1 mídia disponível e a cliente demonstrou interesse: vá direto ao PASSO 2.
- Se há várias: liste pelos nomes de exibição e pergunte qual ela quer (PASSO 1), depois envie (PASSO 2).
- Quando ela escolher: use o id exato correspondente em mediaName. Nunca invente um nome fora da lista.
- Nunca mostre o id exato na conversa — use sempre o nome de exibição.`
      : `AVISO: Sem mídias cadastradas. Não ofereça vídeos — vá direto ao fechamento.`;

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
    // buildDateBlock sempre injetado, independente de prompt customizado no banco
    const extraBlock = extraSystemContext ? `\n\n${extraSystemContext}` : '';
    const systemPrompt = `${buildDateBlock()}\n\n${basePrompt}\n\n${mediaInstructions}${JSON_FORMAT_MEGAHAIR}${extraBlock}`;

    const messages: any[] = [
      ...history,
      { role: 'user', content: incomingText },
    ];

    try {
      const response = await callWithRetry(
        () => this.client.chat.completions.create({
          model: this.chatModel,
          max_tokens: 512,
          messages: [
            { role: 'system', content: systemPrompt },
            ...messages as any,
          ],
        } as any),
        this.logger,
      );

      let raw = response.choices[0].message.content?.trim() ?? '';
      this.logger.debug(`[LINDONA] Resposta bruta: ${raw}`);
      raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Resposta sem JSON válido');
      const parsed: AiResponse = JSON.parse(jsonMatch[0]);
      parsed.success = true;
      parsed.rawJson = jsonMatch[0];
      return parsed;
    } catch (err) {
      this.logger.error(`❌ [LINDONA] Erro ao chamar IA: ${err.message}`);
      this.logger.error(`❌ [LINDONA] Stack: ${err.stack}`);
      this.logger.error(`❌ [LINDONA] Enviando resposta de fallback "probleminha"`);
      return { reply: 'Oi! Tive um probleminha aqui, pode repetir? 😊', success: false };
    }
  }
}
