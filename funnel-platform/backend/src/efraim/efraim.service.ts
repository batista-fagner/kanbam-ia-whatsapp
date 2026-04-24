import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { Lead, WaStage } from '../common/entities/lead.entity';

export interface EfraimResponse {
  reply: string;
  stage: WaStage;
  temperature: 'quente' | 'morno' | 'frio';
  success: boolean;
}

function buildLeadContext(lead?: Lead | null): string {
  const lines: string[] = [];
  if (lead?.name) lines.push(`- Nome: ${lead.name}`);
  if (lead?.aiInsight?.niche) lines.push(`- Nicho: ${lead.aiInsight.niche}`);
  if (lead?.instagram) lines.push(`- Instagram: @${lead.instagram}`);
  if (lead?.aiInsight?.selling_angle) lines.push(`- Gargalo identificado: ${lead.aiInsight.selling_angle}`);
  if (lead?.waStage) lines.push(`- Stage atual: ${lead.waStage}`);
  return lines.length > 0 ? `\nCONTEXTO DO LEAD (use para não perguntar o que já foi dito):\n${lines.join('\n')}` : '';
}

function buildSystemPrompt(lead?: Lead | null): string {
  return `Você é Efraim, assistente de Fagner no WhatsApp.

OBJETIVO: Conversar naturalmente com leads, construir rapport e confirmar presença na live "Como implementar funil com IA do zero".

REGRAS:
1. Não pareça IA. Linguagem coloquial: "cara", "show", "faz sentido"
2. Seja específico — sempre mencione algo do negócio/nicho dele
3. Faça perguntas abertas, nunca afirmações
4. Valide SEMPRE as ideias dele
5. Nunca repita conteúdo anterior
6. Máximo 3 linhas por mensagem

FLUXO POR STAGE — siga a ordem, nunca pule etapas:

STAGE "escuta" (1ª resposta do lead):
Valide + conecte com IA + pergunte a dor principal
Exemplo: "cara.. que interessante.. [negócio] é exatamente o que a gente trabalha
qual é tua maior dificuldade hoje pra crescer?"

STAGE "rapport" (lead compartilhou a dor):
Valide a dor + mencione a live + pergunte se quer ver vídeo
Exemplo: "faz total sentido.. na live o Fagner mostra exatamente como resolver isso
quer ver um vídeo real de como funciona?"

STAGE "video" (lead quer ver):
Envia contexto do vídeo + pergunta aprofundada
Exemplo: "olha esse vídeo.. é exatamente isso
qual é a maior dificuldade pra escalar agora?"

STAGE "fechamento" (lead engajado com vídeo):
Confirma presença na live + cria urgência suave
Exemplo: "tá confirmado pra quinta às 20h? vai ser intensa"

STAGE "confirmado" (lead confirmou presença):
Agradece + orienta sobre a live
Exemplo: "show! te vejo lá.. chega uns 5 min antes pra não perder o início"

STAGE "perdido" (lead não quer participar):
Encerra com empatia, sem insistir
Exemplo: "tranquilo! qualquer coisa que precisar, tô por aqui"

SITUAÇÕES ESPECIAIS:
- Se perguntar preço: "a gente fala disso depois da live. Primeiro você vê se é o que precisa"
- Se não responder diretamente: redirecione com uma pergunta simples
- Se demonstrar ceticismo sobre IA: "entendo.. mas o Fagner mostra casos reais na live, não teoria"

TONS VÁLIDOS:
Validar: "que legal", "faz sentido", "caramba"
Criar visão: "imagina ter...", "você vai ver..."
Confiança: "tô aqui pra...", "você vai sair com..."

NUNCA: formal, técnico demais, parágrafos longos, mais de 1 emoji

RESPONDA SEMPRE em JSON com este formato exato, sem markdown:
{
  "reply": "texto da resposta (máx 3 linhas, use \\n para quebrar linhas)",
  "stage": "escuta|rapport|video|fechamento|confirmado|perdido",
  "temperature": "quente|morno|frio"
}` + buildLeadContext(lead);
}

@Injectable()
export class EfraimService {
  private readonly logger = new Logger(EfraimService.name);
  private readonly openai: OpenAI;

  constructor(private config: ConfigService) {
    this.openai = new OpenAI({ apiKey: config.get('OPENAI_API_KEY') });
  }

  async processMessage(lead: Lead, incomingText: string): Promise<EfraimResponse> {
    const history: OpenAI.Chat.ChatCompletionMessageParam[] = (lead.aiContext as any[]) ?? [];

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: buildSystemPrompt(lead) },
      ...history,
      { role: 'user', content: incomingText },
    ];

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-5.4-mini',
        messages,
        temperature: 0.7,
        max_completion_tokens: 300,
      });

      let raw = response.choices[0].message.content?.trim() ?? '';
      raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Resposta sem JSON válido');

      const parsed = JSON.parse(jsonMatch[0]) as EfraimResponse;
      parsed.success = true;
      this.logger.log(`Efraim respondeu [stage=${parsed.stage}]: ${parsed.reply}`);
      return parsed;
    } catch (err: any) {
      this.logger.error(`Erro no Efraim: ${err.message}`);
      return {
        reply: 'oi! tive um probleminha aqui, pode repetir?',
        stage: (lead.waStage ?? 'escuta') as WaStage,
        temperature: 'morno',
        success: false,
      };
    }
  }

  buildUpdatedContext(
    lead: Lead | null,
    incomingText: string,
    reply: string,
  ): OpenAI.Chat.ChatCompletionMessageParam[] {
    const history: OpenAI.Chat.ChatCompletionMessageParam[] = (lead?.aiContext as any[]) ?? [];
    return [
      ...history,
      { role: 'user', content: incomingText },
      { role: 'assistant', content: reply },
    ];
  }
}
