import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { Lead } from '../common/entities/lead.entity';

export interface AiResponse {
  reply: string;
  success?: boolean;
  rawJson?: string;
  stage?: string;
  temperature?: string;
  action?: 'schedule' | 'cancel' | 'reschedule' | 'none';
  appointmentDateTime?: string; // ISO 8601: "2026-03-28T09:00:00"
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

function buildSystemPrompt(): string {
  const diasSemana = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

  const now = new Date();
  const dataHoje = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()}`;
  const diaSemanaHoje = diasSemana[now.getDay()];

  // Gera calendário dos próximos 7 dias para a IA não precisar calcular
  const proximosDias = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() + i + 1);
    const dd = d.getDate().toString().padStart(2, '0');
    const mm = (d.getMonth() + 1).toString().padStart(2, '0');
    const yyyy = d.getFullYear();
    return `- ${diasSemana[d.getDay()]}: ${dd}/${mm}/${yyyy}`;
  }).join('\n');

  return `Você é Sofia, secretária virtual de uma clínica de fisioterapia.
Seu objetivo é qualificar leads via WhatsApp de forma natural, empática e profissional.

DATA DE HOJE: ${dataHoje} (${diaSemanaHoje})
PRÓXIMOS 7 DIAS (use exatamente estas datas, não calcule):
${proximosDias}
NUNCA agende em datas anteriores à data de hoje. Use sempre a data do calendário acima ao mencionar dias da semana.

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
- Se o paciente disser "sexta" ou "amanhã", calcule a data exata com base na DATA DE HOJE acima.
- Antes de definir action="schedule", SEMPRE confirme com o paciente a data completa (dia/mês) e horário. Ex: "Ótimo! Confirmo sua consulta para sexta-feira, dia 03/04, às 14h. Está certo?"
- Só defina action="schedule" e appointmentDateTime APÓS o paciente confirmar a data e hora apresentadas.
- O appointmentDateTime deve ser no formato ISO 8601: "2026-04-03T14:00:00"
- Quando o sistema informar que o horário está ocupado, ofereça os horários alternativos disponíveis.

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

REGRAS PARA perdido:
- Nunca insista após recusa clara. Resposta empática de despedida e marque como perdido.

RESPONDA SEMPRE em JSON com este formato exato:
{
  "reply": "texto da resposta para o lead",
  "stage": "novo_lead|qualificando|lead_quente|lead_frio|agendado|perdido",
  "temperature": "quente|morno|frio",
  "action": "schedule|cancel|reschedule|none",
  "appointmentDateTime": "2026-04-03T14:00:00 ou null",
  "fields": {
    "name": "nome se coletado",
    "symptoms": "sintomas se coletados",
    "urgency": "alta|media|baixa se identificado",
    "availability": "disponibilidade se coletada",
    "budget": "confirmado|recusado se reagiu ao valor",
    "qualificationScore": número de 0 a 100,
    "qualificationStep": 0 a 4
  }
}`;}


@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly client: Anthropic;

  constructor(private config: ConfigService) {
    this.client = new Anthropic({
      apiKey: config.get('ANTHROPIC_API_KEY'),
    });
  }

  async processMessage(lead: Lead, incomingText: string): Promise<AiResponse> {
    const history = (lead.aiContext as any[]) ?? [];

    const messages: Anthropic.MessageParam[] = [
      ...history,
      { role: 'user', content: incomingText },
    ];

    try {
      const response = await this.client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        system: buildSystemPrompt(),
        messages,
      });

      let raw = (response.content[0] as Anthropic.TextBlock).text.trim();
      this.logger.debug(`Resposta bruta do Claude: ${raw}`);
      raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');
      // Extrai só o bloco JSON caso venha com texto antes/depois
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
      this.logger.error(`Erro ao chamar Claude: ${err.message}`);
      this.logger.error(err.stack);
      return { reply: 'Olá! Tive um probleminha aqui, pode repetir?', success: false };
    }
  }

  buildUpdatedContext(
    lead: Lead,
    incomingText: string,
    rawJson: string,
  ): Anthropic.MessageParam[] {
    const history = (lead.aiContext as Anthropic.MessageParam[]) ?? [];
    return [
      ...history,
      { role: 'user', content: incomingText },
      { role: 'assistant', content: rawJson },
    ];
  }
}
