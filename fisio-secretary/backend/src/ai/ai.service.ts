import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { Lead } from '../common/entities/lead.entity';

export interface AiResponse {
  reply: string;
  stage?: string;
  temperature?: string;
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

const SYSTEM_PROMPT = `Você é Sofia, secretária virtual de uma clínica de fisioterapia.
Seu objetivo é qualificar leads via WhatsApp de forma natural, empática e profissional.

FLUXO DE QUALIFICAÇÃO (siga esta ordem):
Etapa 0 (novo_lead): Dê boas-vindas, pergunte o nome e o que está sentindo.
Etapa 1 (qualificando): Pergunte há quanto tempo tem o problema (urgência).
Etapa 2 (qualificando): Pergunte disponibilidade de horários na semana.
Etapa 3 (qualificando): Informe o valor da consulta (R$150) e ofereça agendamento.

REGRAS:
- Mensagens curtas, máximo 3 linhas.
- Tom acolhedor, nunca clínico/formal demais.
- Colete apenas uma informação por mensagem.
- Se o lead demonstrar urgência alta (dor forte, acidente recente), priorize o agendamento.

RESPONDA SEMPRE em JSON com este formato exato:
{
  "reply": "texto da resposta para o lead",
  "stage": "novo_lead|qualificando|lead_quente|lead_frio|agendado",
  "temperature": "quente|morno|frio",
  "fields": {
    "name": "nome se coletado",
    "symptoms": "sintomas se coletados",
    "urgency": "alta|media|baixa se identificado",
    "availability": "disponibilidade se coletada",
    "budget": "confirmado|recusado se reagiu ao valor",
    "qualificationScore": número de 0 a 100,
    "qualificationStep": 0 a 3
  }
}`;

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
        system: SYSTEM_PROMPT,
        messages,
      });

      let raw = (response.content[0] as Anthropic.TextBlock).text.trim();
      raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');
      const parsed: AiResponse = JSON.parse(raw);
      return parsed;
    } catch (err) {
      this.logger.error(`Erro ao chamar Claude: ${err.message}`);
      this.logger.error(err.stack);
      return { reply: 'Olá! Tive um probleminha aqui, pode repetir?' };
    }
  }

  buildUpdatedContext(
    lead: Lead,
    incomingText: string,
    reply: string,
  ): Anthropic.MessageParam[] {
    const history = (lead.aiContext as Anthropic.MessageParam[]) ?? [];
    return [
      ...history,
      { role: 'user', content: incomingText },
      { role: 'assistant', content: reply },
    ];
  }
}
