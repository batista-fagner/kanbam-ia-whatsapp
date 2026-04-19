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

      const prompt = `Você é um especialista em vendas de implementação de IA para empresas. Analise o perfil do empresário no Instagram e gere uma abordagem persuasiva focada em como IA pode potencializar o negócio dele.

DADOS DO LEAD (Empresário):
Nome: ${name}
Instagram: ${instagram}
Seguidores: ${followers.toLocaleString()}
Taxa de Engajamento: ${(engagementRate * 100).toFixed(2)}%
Bio: "${biography}"

CONTEÚDO RECENTE:
${postsData}

CONTEXTO: Você vende implementação de IA para automação, análise de dados, chatbots e otimização de processos.

Analise e gere um JSON com os seguintes campos:
{
  "niche": "Identificar o segmento/indústria do empresário (ex: e-commerce, consultoria, agência, etc)",
  "engagement_level": "Nível de engajamento (baixo/médio/alto) - indica quanto tempo tem para inovação",
  "audience_profile": "Tipo de público que ele atrai (B2B, B2C, profissionais, etc)",
  "content_pattern": "Padrão: educacional, vendas, inspirational, etc - mostra sua abordagem de negócio",
  "selling_angle": "Oportunidade específica de IA para seu negócio baseada no que vemos (máx 100 chars)",
  "outreach_message": "Mensagem de abertura persuasiva para iniciar conversa sobre implementação de IA (máx 180 chars, português)",
  "confidence_score": "Confiança (0-100)"
}

Foque em: demonstrar conhecimento do negócio dele, mencionar benefício específico de IA, criar urgência subtil.
Responda APENAS com o JSON, sem markdown.`;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.7,
        max_tokens: 500,
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
