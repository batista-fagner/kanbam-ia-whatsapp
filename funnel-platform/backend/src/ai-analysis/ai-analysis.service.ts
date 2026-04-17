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

      const prompt = `Você é um especialista em análise de leads para vendas B2B/B2C. Analise os dados de um usuário do Instagram e forneça insights acionáveis para vendedores.

DADOS DO LEAD:
Nome: ${name}
Instagram: ${instagram}
Seguidores: ${followers.toLocaleString()}
Taxa de Engajamento: ${(engagementRate * 100).toFixed(2)}%
Bio: "${biography}"

ÚLTIMOS 3 POSTS:
${postsData}

Forneça uma análise em JSON com os seguintes campos:
{
  "niche": "Identificar o nicho/indústria principal (ex: educação financeira, marketing digital, lifestyle, etc)",
  "engagement_level": "Avaliar o nível de engajamento (baixo/médio/alto/muito alto) com justificativa breve",
  "audience_profile": "Descrever brevemente quem provavelmente segue este usuário",
  "content_pattern": "Padrão de conteúdo identificado (ex: educativo, motivacional, comercial, etc)",
  "selling_angle": "Sugestão de produto/serviço que faria sentido vender para este lead (máx 100 caracteres)",
  "outreach_message": "Mensagem personalizada curta para abordar este lead (máx 150 caracteres, em português)",
  "confidence_score": "Confiança da análise de 0 a 100"
}

Responda APENAS com o JSON, sem markdown ou explicações adicionais.`;

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
