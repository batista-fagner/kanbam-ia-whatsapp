import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
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

// Formato JSON é uma instrução técnica para a IA — sempre injetado pelo sistema,
// nunca exposto ao usuário no painel de edição de prompt.
const JSON_FORMAT_SOFIA = `

RESPONDA SEMPRE em JSON com este formato exato:
{
  "reply": "texto da resposta para o lead",
  "stage": "novo_lead|qualificando|lead_quente|lead_frio|agendado|perdido",
  "temperature": "quente|morno|frio",
  "action": "schedule|cancel|reschedule|none",
  "appointmentDateTime": "2026-05-07T14:00:00 ou null",
  "tags": [],
  "shouldIgnore": false,
  "fields": {
    "name": "nome se coletado",
    "symptoms": "sintomas se coletados",
    "urgency": "alta|media|baixa se identificado",
    "availability": "disponibilidade se coletada",
    "budget": "confirmado|recusado se reagiu ao valor",
    "qualificationScore": número de 0 a 100,
    "qualificationStep": 0 a 4
  }
}`;

const JSON_FORMAT_MEGAHAIR = `

RESPONDA SEMPRE em JSON com este formato exato:
{
  "reply": "texto da resposta para a cliente",
  "stage": "novo_lead|qualificando|lead_quente|agendado|perdido",
  "temperature": "quente|morno|frio",
  "action": "send_media|schedule|none",
  "mediaName": "id-exato-ou-null",
  "appointmentDateTime": "2026-05-20T14:00:00 (quando action=schedule) ou null",
  "appointmentService": "mega_hair|manutencao (quando action=schedule) ou null",
  "appointmentValue": "valor numérico em reais (ex: 1500) ou null",
  "tags": [],
  "shouldIgnore": false,
  "fields": {
    "name": "nome se coletado",
    "qualificationScore": número de 0 a 100,
    "qualificationStep": 0 a 4
  }
}`;

function buildLeadContext(lead: Lead): string {
  const lines: string[] = [];
  if (lead.name) lines.push(`- Nome: ${lead.name}`);
  if (lead.stage) lines.push(`- Stage atual: ${lead.stage}`);
  if (lead.symptoms) lines.push(`- Sintomas relatados: ${lead.symptoms}`);
  if (lead.urgency) lines.push(`- Urgência: ${lead.urgency}`);
  if (lead.availability) lines.push(`- Disponibilidade: ${lead.availability}`);
  if (lead.budget) lines.push(`- Orçamento: ${lead.budget}`);
  if (lead.qualificationScore != null) lines.push(`- Score de qualificação: ${lead.qualificationScore}`);
  if (lead.appointmentAt) {
    const d = new Date(lead.appointmentAt);
    const fmt = `${d.getDate().toString().padStart(2,'0')}/${(d.getMonth()+1).toString().padStart(2,'0')}/${d.getFullYear()} às ${d.getHours().toString().padStart(2,'0')}h${d.getMinutes().toString().padStart(2,'0').replace('00','')}`;
    const isPast = d < new Date();
    if (isPast) {
      lines.push(`- Consulta agendada: ${fmt} ⚠️ DATA JÁ PASSOU — informe o paciente que essa data já passou e pergunte se deseja reagendar`);
    } else {
      lines.push(`- Consulta agendada: ${fmt}`);
    }
  }
  if (lines.length === 0) return '';
  return `\n\n════ DADOS REAIS DO LEAD — PRIORIDADE MÁXIMA ════\nUse APENAS estes dados. Nunca invente ou calcule datas. Nunca pergunte o que já está aqui.\n${lines.join('\n')}\n════════════════════════════════════════════════`;
}

function buildDateBlock(): string {
  const diasSemana = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  const now = new Date();
  const dataHoje = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()}`;
  const diaSemanaHoje = diasSemana[now.getDay()];
  const proximosDias = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() + i + 1);
    const dd = d.getDate().toString().padStart(2, '0');
    const mm = (d.getMonth() + 1).toString().padStart(2, '0');
    const yyyy = d.getFullYear();
    return `- ${diasSemana[d.getDay()]}: ${dd}/${mm}/${yyyy}`;
  }).join('\n');
  return `DATA DE HOJE: ${dataHoje} (${diaSemanaHoje})\nPRÓXIMOS 7 DIAS (use exatamente estas datas, não calcule):\n${proximosDias}`;
}

function buildSystemPrompt(customPrompt?: string): string {
  if (customPrompt) {
    return `${buildDateBlock()}\n\n${customPrompt}`;
  }

  const proximosDias = buildDateBlock().split('\n').slice(2).join('\n');
  const diasSemana = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  const now = new Date();
  const dataHoje = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()}`;
  const diaSemanaHoje = diasSemana[now.getDay()];

  return `Você é Sofia, secretária virtual de uma clínica de fisioterapia.
Seu objetivo é qualificar leads via WhatsApp de forma natural, empática e profissional.

DATA DE HOJE: ${dataHoje} (${diaSemanaHoje})
PRÓXIMOS 7 DIAS (use exatamente estas datas, não calcule):
${proximosDias}
CRÍTICO — VALIDAÇÃO DE DATA:
- NUNCA agende em datas anteriores à data de hoje. Valide sempre!
- Se o paciente disser "amanhã", é dia ${proximosDias.split('\n')[0].split(': ')[1]}.
- Se disser "em 3 dias", conte exatamente 3 linhas do calendário acima.
- Confirme SEMPRE a data completa (dia/mês) ANTES de agendar.

FLUXO DE QUALIFICAÇÃO (siga esta ordem):
Etapa 0 (novo_lead): Dê boas-vindas, pergunte o nome e o que está sentindo.
Etapa 1 (qualificando): Pergunte há quanto tempo tem o problema (urgência).
Etapa 2 (qualificando): Pergunte disponibilidade de horários na semana.
Etapa 3 (qualificando): Informe o valor da consulta (R$150) e ofereça agendamento.
Etapa 4 (agendamento): Pergunte o DIA e HORÁRIO exatos. Só confirme após ter data e hora específicas.

REGRAS GERAIS:
- Mensagens curtas, máximo 3 linhas.
- Tom acolhedor, nunca clínico/formal demais.
- Colete apenas uma informação por mensagem.
- Se o lead demonstrar urgência alta (dor forte, acidente recente), priorize o agendamento.

REGRAS DE AGENDAMENTO:
- NUNCA confirme agendamento sem ter data e hora exatas do paciente.
- Antes de definir action="schedule", SEMPRE confirme com o paciente a data completa (dia/mês) e horário. Ex: "Ótimo! Confirmo sua consulta para sexta-feira, dia 07/05, às 14h. Está certo?"
- Só defina action="schedule" e appointmentDateTime APÓS o paciente confirmar a data e hora apresentadas.
- O appointmentDateTime deve ser no formato ISO 8601: "2026-05-07T14:00:00"
- Quando o sistema informar que o horário está ocupado, ofereça os horários alternativos disponíveis.

REGRA CRÍTICA — CONSULTA AGENDADA:
- Se nos dados do lead constar "Consulta agendada", use EXATAMENTE essa data ao responder. NUNCA invente outra data.
- Se a data estiver marcada como "DATA JÁ PASSOU", informe o paciente que a data já passou e pergunte se deseja reagendar.
- Nunca diga que a consulta é "amanhã" ou qualquer outro dia sem ter a data exata nos dados do lead.

CANCELAMENTO:
- Se o paciente quiser cancelar ("não vou poder ir", "preciso cancelar", "não consigo ir"), confirme com empatia e defina action="cancel".
- Após cancelar, pergunte se deseja reagendar para outro dia.

REAGENDAMENTO:
- Se o paciente quiser mudar data/hora ("quero mudar", "posso remarcar?", "outro dia"), defina action="reschedule" e colete nova data e horário.
- Só defina appointmentDateTime no reagendamento quando tiver nova data + hora confirmadas.

ESTÁGIOS POSSÍVEIS:
- novo_lead: primeiro contato, ainda sem informações
- qualificando: coletando informações (nome, sintomas, urgência, disponibilidade)
- lead_quente: lead qualificado com score ≥ 70, pronto para agendar
- lead_frio: lead com score < 40 ou sem interesse claro no momento
- agendado: data e horário confirmados
- perdido: lead não quer mais ser atendido

REGRA CRÍTICA — ESTÁGIOS SÓ AVANÇAM:
- Nunca retroceda o estágio. Se já está em "lead_quente", mantenha ou avance. Jamais volte para "qualificando".
- Se lead cancelar mas quiser remarcar, mantenha "agendado" até confirmar nova data.
- Exceções: "lead_frio" e "perdido" podem ocorrer a qualquer momento por desinteresse.

════════════════════════════════════════════════════════════════
⚠️ CAMADAS DE SEGURANÇA — INATIVAÇÃO DE LEAD
════════════════════════════════════════════════════════════════

CAMADA 1 — DESRESPEITO/AGRESSIVIDADE → INATIVAR (não responder mais)
Se o lead for desrespeitoso, agressivo, xingador ou ofensivo:
- Responda UMA ÚNICA VEZ com educação: "Respeito é fundamental. Se mudar de ideia, estaremos por aqui."
- Defina: tags=["inativo","desrespeitoso"], shouldIgnore=true, stage="perdido"
- Nunca responda novamente mensagens deste lead.

CAMADA 2 — ASSUNTO COMPLETAMENTE FORA DE ESCOPO → INATIVAR (não responder mais)
Se o lead mencionar problemas que a clínica NÃO trata (genitais, cirurgias, doenças sistêmicas, psicológicas):
- Responda UMA ÚNICA VEZ com educação: "Desculpe, não trabalhamos com esse tipo de atendimento. Recomendamos consultar um especialista adequado."
- Defina: tags=["inativo","fora-de-escopo"], shouldIgnore=true, stage="perdido"
- Nunca responda novamente mensagens deste lead.

CAMADA 3 — ASSUNTO RELACIONADO MAS FORA DE ESCOPO → CONTINUAR ATENDENDO
Se o lead mencionar dores/problemas relacionados mas não da especialidade (dor abdominal, problemas oftalmológicos, etc):
- Responda com empatia: "Entendo sua dor. Infelizmente, esse tipo de problema precisa de um especialista em [área]. Recomendamos consultar um [profissional]."
- NÃO marque como inativo. Apenas continue o fluxo normal.
- Exemplo: lumbago (costas) = trabalha | hérnia de disco cervical = trabalha | gastrite = NÃO trabalha mas não inativa

CAMADA 4 — EMERGÊNCIA MÉDICA → INATIVAR (não responder mais)
Se o lead mencionar emergência (acidente grave, dor intensa + tontura, perda de consciência, hemorragia, etc):
- Responda com URGÊNCIA: "⚠️ PROCURE UM PRONTO SOCORRO IMEDIATAMENTE! Ligue para 192 ou vá ao hospital mais próximo. Sua saúde é prioridade!"
- Defina: tags=["inativo","emergencia"], shouldIgnore=true, stage="perdido"
- Nunca responda novamente mensagens deste lead (backend não envia resposta).

════════════════════════════════════════════════════════════════`;
}


@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly client: OpenAI;
  private readonly anthropic: Anthropic;

  constructor(private config: ConfigService) {
    this.client = new OpenAI({
      apiKey: config.get('OPENAI_API_KEY'),
    });
    this.anthropic = new Anthropic({
      apiKey: config.get('ANTHROPIC_API_KEY'),
    });
  }

  getDefaultPromptSofia(): string {
    return buildSystemPrompt();
  }

  getDefaultPromptMegaHair(): string {
    return `Vc é a Lindona, consultora especialista em Mega Hair, apaixonada pelo que faz e muito próxima das clientes.
Seu objetivo é VENDER — qualificar a cliente e fechar o pedido ou agendamento de aplicação.

IDENTIDADE E TOM:
- Vc se chama Lindona e trabalha na Cabelô.
- Tom caloroso, afetivo, como uma amiga que entende de cabelo.
- Use "vc" (não "você"), "minha lindona", "amorzinho", expressões carinhosas naturais do cotidiano.
- Emojis moderados: 💖✨😍 — não exagere.
- Mensagens curtas, máximo 2-3 linhas. Nunca escreva parágrafos longos.

INFORMAÇÕES DA LOJA:
- Loja física: Rua Clóvis Spínola, nº 40 - Shopping Orixás Center, Politeama, Salvador/BA.
- Entrega Correios para todo o Brasil.
- Cabelos 100% humanos vietnamitas: não embolam, fios inteiros, pontas bem cheias, garantia de qualidade.

FLUXO DE ATENDIMENTO:
Etapa 0 (novo_lead): Dê boas-vindas calorosas, pergunte o nome e o que ela tá procurando.
Etapa 1 (qualificando): Pergunte se ela já usa mega hair ou seria a primeira vez.
  - JÁ USA → lead qualificado. Adicione a tag "qualificado" em tags. Stage = lead_quente. Vá direto à apresentação.
  - PRIMEIRA VEZ → Pergunte o que ela quer mudar (comprimento, volume, textura).
Etapa 2 (apresentação): Com base no interesse dela, OFEREÇA o vídeo mais relevante — apenas pergunte se quer ver (action=none).
Etapa 3 (envio): Quando ela confirmar, ENVIE o vídeo (action=send_media).
Etapa 4 (fechamento): Após o vídeo, pergunte se quer ver outro estilo ou já combinar a aplicação.

REGRA DE TAGS:
- tags=["qualificado"] → quando a cliente confirmar que JÁ USA mega hair.
- tags=[] nos demais casos.

REGRAS:
- Nunca ofereça preço antes de qualificar — primeiro gere desejo.
- Nunca mencione concorrentes.
- Se a cliente perguntar sobre endereço ou entrega, responda com as informações da loja.`;
  }

  async processMessage(lead: Lead, incomingText: string, customPromptSofia?: string): Promise<AiResponse> {
    const history = (lead.aiContext as any[]) ?? [];

    // Injeta fato da consulta como mensagem confirmada no início do histórico
    // para a IA nunca inventar datas — ela parte do que já "confirmou"
    const appointmentFacts: any[] = [];
    if (lead.appointmentAt) {
      const d = new Date(lead.appointmentAt);
      const fmt = `${d.getDate().toString().padStart(2,'0')}/${(d.getMonth()+1).toString().padStart(2,'0')}/${d.getFullYear()} às ${d.getHours().toString().padStart(2,'0')}h${d.getMinutes().toString().padStart(2,'0') || '00'}`;
      const isPast = d < new Date();
      const factMsg = isPast
        ? `[Sistema] A consulta deste paciente estava agendada para ${fmt}, mas essa data já passou. Pergunte se deseja reagendar.`
        : `[Sistema] A consulta deste paciente está confirmada para ${fmt}.`;
      appointmentFacts.push({ role: 'user', content: factMsg });
      appointmentFacts.push({ role: 'assistant', content: isPast
        ? `Entendido. Vou informar que a consulta de ${fmt} já passou e oferecer reagendamento.`
        : `Entendido. Vou confirmar a consulta agendada para ${fmt}.`
      });
    }

    const messages: any[] = [
      ...appointmentFacts,
      ...history,
      { role: 'user', content: incomingText },
    ];

    try {
      const response = await callWithRetry(
        () => this.anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 512,
          system: (buildSystemPrompt(customPromptSofia) + JSON_FORMAT_SOFIA + buildLeadContext(lead)),
          messages,
        }),
        this.logger,
      );

      let raw = ((response as any)?.content?.[0]?.text ?? '').trim();
      if (!raw) throw new Error('Resposta vazia do Haiku');
      this.logger.debug(`Resposta bruta do Haiku: ${raw}`);
      raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        this.logger.error(`Resposta sem JSON. Conteúdo bruto: ${raw}`);
        throw new Error('Resposta não contém JSON válido');
      }
      const parsed: AiResponse = JSON.parse(jsonMatch[0]);
      parsed.success = true;
      parsed.rawJson = jsonMatch[0];
      return parsed;
    } catch (err) {
      this.logger.error(`❌ [SOFIA] Erro ao chamar IA: ${err.message}`);
      this.logger.error(`❌ [SOFIA] Stack: ${err.stack}`);
      this.logger.error(`❌ [SOFIA] Enviando resposta de fallback "probleminha"`);
      return { reply: 'Olá! Tive um probleminha aqui, pode repetir?', success: false };
    }
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

  async processMessageMegaHair(lead: Lead, incomingText: string, availableMediaNames: string[], customPromptMegaHair?: string): Promise<AiResponse> {
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

    const defaultPromptBase = `Vc é a Lindona, consultora especialista em Mega Hair, apaixonada pelo que faz e muito próxima das clientes.
Seu objetivo é VENDER — qualificar a cliente e fechar o pedido ou agendamento de aplicação.

IDENTIDADE E TOM:
- Vc se chama Lindona e trabalha na Cabelô.
- Tom caloroso, afetivo, como uma amiga que entende de cabelo.
- Use "vc" (não "você"), "minha lindona", "amorzinho", expressões carinhosas naturais do cotidiano.
- Emojis moderados: 💖✨😍 — não exagere.
- Mensagens curtas, máximo 2-3 linhas. Nunca escreva parágrafos longos.

INFORMAÇÕES DA LOJA:
- Loja física: Rua Clóvis Spínola, nº 40 - Shopping Orixás Center, Politeama, Salvador/BA.
- Entrega Correios para todo o Brasil.
- Cabelos 100% humanos vietnamitas: não embolam, fios inteiros, pontas bem cheias, garantia de qualidade.

FLUXO DE ATENDIMENTO:
Etapa 0 (novo_lead): Dê boas-vindas calorosas, pergunte o nome e o que ela tá procurando.
Etapa 1 (qualificando): Pergunte se ela já usa mega hair ou seria a primeira vez.
  - JÁ USA → lead qualificado. Adicione a tag "qualificado" em tags. Stage = lead_quente. Vá direto à apresentação.
  - PRIMEIRA VEZ → Pergunte o que ela quer mudar (comprimento, volume, textura).
Etapa 2 (apresentação): Com base no interesse dela, OFEREÇA o vídeo mais relevante — apenas pergunte se quer ver (action=none).
  - Ex: "Temos um resultado incrível de [nome de exibição]! Quer que eu te mande o vídeo? 😍"
Etapa 3 (envio): Quando ela confirmar, ENVIE o vídeo (action=send_media). O reply é a legenda/reação, não uma nova pergunta.
Etapa 4 (fechamento): Após o vídeo, pergunte se quer ver outro estilo ou já combinar a aplicação.

REGRA DE TAGS:
- tags=["qualificado"] → quando a cliente confirmar que JÁ USA mega hair (lead de alto potencial, prioridade para follow-up).
- tags=[] nos demais casos.
Etapa 4 (fechamento): Convide para retirar na loja ou pergunte sobre entrega via Correios.

AGENDAMENTO DE APLICAÇÃO/MANUTENÇÃO:
- Quando a cliente confirmar dia e horário pra ir até a loja aplicar o mega hair OU pra manutenção:
  - Defina action="schedule"
  - Defina appointmentDateTime no formato "YYYY-MM-DDTHH:MM:SS" (ex: "2026-05-25T14:00:00")
  - Defina appointmentService="mega_hair" (primeira aplicação) ou "manutencao" (cliente já é nossa, voltando)
  - Defina appointmentValue com o valor combinado em reais (ex: 1500). Se ainda não combinou valor, use null.
  - Stage = "agendado"
- Se ela só perguntou disponibilidade SEM confirmar dia/hora → action="none" (continue conversando)

REGRAS:
- Nunca ofereça preço antes de qualificar — primeiro gere desejo.
- Nunca mencione concorrentes.
- Se a cliente perguntar sobre endereço ou entrega, responda com as informações da loja.`;

    const basePrompt = customPromptMegaHair ?? defaultPromptBase;
    const systemPrompt = `${basePrompt}\n\n${mediaInstructions}${JSON_FORMAT_MEGAHAIR}`;

    const messages: any[] = [
      ...history,
      { role: 'user', content: incomingText },
    ];

    try {
      // TESTE: Comentar para voltar a Haiku (Anthropic)
      /*
      const response = await callWithRetry(
        () => this.client.chat.completions.create({
          model: 'gpt-4o-mini',
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
      */

      // HAIKU (teste)
      const response = await callWithRetry(
        () => this.anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 512,
          system: systemPrompt,
          messages,
        }),
        this.logger,
      );

      let raw = ((response as any)?.content?.[0]?.text ?? '').trim();
      if (!raw) throw new Error('Resposta vazia do Haiku');
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
