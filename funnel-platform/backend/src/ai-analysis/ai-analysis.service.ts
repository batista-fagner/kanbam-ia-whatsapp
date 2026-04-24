import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { Post } from '../common/entities/lead.entity';

export interface LeadInsight {
  niche: string;
  engagement_level: string;
  audience_profile: string;
  content_pattern: string;
  selling_angle: string;
  outreach_message: string;
  confidence_score: number;
}

@Injectable()
export class AiAnalysisService {
  private readonly logger = new Logger(AiAnalysisService.name);
  private openai: OpenAI;

  constructor(private config: ConfigService) {
    const apiKey = config.get('OPENAI_API_KEY');
    this.openai = new OpenAI({ apiKey });
  }

  async analyzeLeadInstagram(
    name: string,
    instagram: string,
    followers: number,
    engagementRate: number,
    biography: string,
    posts: Post[],
  ): Promise<LeadInsight> {
    try {
      const postsData = posts
        .map(
          (p) =>
            `Post: "${p.caption.substring(0, 150)}..." | Curtidas: ${p.likeCount} | Comentários: ${p.commentCount}`,
        )
        .join('\n');

      const firstName = name.split(' ')[0];

      const prompt = `Você é um especialista em análise de perfis do Instagram e funis de vendas com IA. Analise o perfil abaixo e gere insights estratégicos + a primeira mensagem de WhatsApp do Efraim (assistente do Fagner).

PERFIL:
Nome: ${name} (chame apenas de ${firstName})
Instagram: ${instagram}
Seguidores: ${followers.toLocaleString()}
Engajamento: ${(engagementRate * 100).toFixed(2)}%
Bio: "${biography}"

POSTS RECENTES:
${postsData}

---

REGRAS PARA outreach_message — MSG 1 DO EFRAIM:

Você é Efraim, assistente de Fagner no WhatsApp. Essa é a PRIMEIRA mensagem que o lead recebe após se inscrever na aula "Como implementar funil com IA do zero".

ESTRUTURA OBRIGATÓRIA (3 linhas curtas):
Linha 1: abertura casual — "faaala ${firstName}.. efraim aqui da equipe do Fagner"
Linha 2: mencione algo ESPECÍFICO do negócio/nicho/conteúdo dele com base no perfil — "vi que você trabalha com [X], que interessante"
Linha 3: pergunta aberta sobre o negócio — "me conta.. qual é tua maior dificuldade hoje com [contexto do nicho]?"

TOM:
- Coloquial, como amigo no WhatsApp: "cara", "show", "faz sentido", "que legal"
- Reticências (".." ou "...") para dar ritmo natural
- Sem emojis ou no máximo 1
- Nunca formal, nunca técnico demais
- Máximo 3 linhas curtas

ERROS A EVITAR:
❌ "Parabéns pelo seu negócio!" (genérico demais)
❌ "Vamos explorar como a IA pode..." (corporativo)
❌ Parágrafos longos
❌ Qualquer frase que poderia ser enviada para qualquer pessoa

EXEMPLO para finanças pessoais com 14k seguidores:
"faaala João.. efraim aqui da equipe do Fagner
vi que você ensina finanças pessoais.. conteúdo importante demais
me conta.. qual é tua maior dificuldade hoje pra converter seus seguidores em clientes?"

Responda APENAS com este JSON, sem markdown:
{
  "niche": "segmento específico (ex: fisioterapia, e-commerce moda, coaching fitness)",
  "engagement_level": "baixo/médio/alto",
  "audience_profile": "descrição concreta do público (ex: mulheres 30-50 buscando rejuvenescimento natural)",
  "content_pattern": "padrão real dos posts (ex: storytelling emocional + antes/depois + provas sociais)",
  "selling_angle": "gargalo específico do funil desse negócio (máx 100 chars)",
  "outreach_message": "MSG 1 do Efraim — 3 linhas curtas separadas por \\n, coloquial, específica para o negócio dele, termina com pergunta aberta",
  "confidence_score": 0-100
}`;

      const response = await this.openai.chat.completions.create({
        // model: 'gpt-4o-mini',
        model: 'gpt-5.4-mini',
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.7,
        max_completion_tokens: 500,
      });

      const content = response.choices[0].message.content;
      if (!content) {
        return this.getDefaultInsight();
      }
      const insight = JSON.parse(content) as LeadInsight;

      this.logger.log(`Lead ${name} analisado com sucesso`);
      return insight;
    } catch (err: any) {
      this.logger.error(`Erro ao analisar lead: ${err.message}`);
      return this.getDefaultInsight();
    }
  }

  private getDefaultInsight(): LeadInsight {
    return {
      niche: 'Não identificado',
      engagement_level: 'Dados insuficientes',
      audience_profile: 'Análise não disponível',
      content_pattern: 'Análise não disponível',
      selling_angle: 'Abordagem manual recomendada',
      outreach_message:
        'Olá! Vimos seu conteúdo e gostaríamos de conversar sobre uma oportunidade.',
      confidence_score: 0,
    };
  }
}
