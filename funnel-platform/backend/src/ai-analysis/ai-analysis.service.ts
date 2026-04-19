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

      const prompt = `Você é um especialista em funis de vendas com IA. Analise o perfil do Instagram abaixo e gere insights + uma mensagem de WhatsApp que pareça HUMANA e PERSONALIZADA — não um template de bot.

PERFIL:
Nome: ${name} (chame apenas de ${firstName})
Instagram: ${instagram}
Seguidores: ${followers.toLocaleString()}
Engajamento: ${(engagementRate * 100).toFixed(2)}%
Bio: "${biography}"

POSTS RECENTES:
${postsData}

REGRAS PARA A MENSAGEM DE WHATSAPP:
1. Parecer que foi escrita por uma pessoa real, não um bot
2. Citar algo ESPECÍFICO da bio ou posts dele (mostrar que você realmente olhou)
3. Mencionar o gargalo REAL desse tipo de negócio (onde ele perde clientes)
4. Falar sobre FUNIL DE VENDAS com IA, não "chatbot" ou "automação genérica"
5. Máximo 2 frases curtas + 1 pergunta direta
6. Tom: direto, informal, confiante — como uma mensagem de alguém que entende do negócio

ERROS COMUNS A EVITAR:
❌ "Imagine atender 24/7 com um chatbot"
❌ "Vamos explorar como a IA pode acelerar seu sucesso"
❌ "Olá! Vimos seu conteúdo e gostaríamos de conversar"
❌ Qualquer frase genérica que poderia ser enviada para qualquer pessoa

EXEMPLOS DO QUE FAZER:
✅ Para fisioterapeuta: "${firstName}, vi que você tem [X]k seguidores mas provavelmente perde pacientes que não recebem resposta rápida. Já estruturou algum funil pra converter essas DMs em consultas?"
✅ Para e-commerce: "${firstName}, conteúdo forte como o seu devia converter mais. O gargalo geralmente é o funil pós-seguidor. Já testou alguma automação nisso?"
✅ Para coach: "${firstName}, sua audiência é engajada. O funil entre 'seguidor' e 'aluno' costuma vazar muito. Posso te mostrar como estruturamos isso com IA?"

Responda APENAS com este JSON, sem markdown:
{
  "niche": "segmento específico (ex: fisioterapia, e-commerce moda, coaching fitness)",
  "engagement_level": "baixo/médio/alto",
  "audience_profile": "descrição concreta do público (ex: mulheres 30-50 buscando rejuvenescimento natural)",
  "content_pattern": "padrão real dos posts (ex: storytelling emocional + antes/depois + provas sociais)",
  "selling_angle": "gargalo específico do funil desse negócio (máx 100 chars)",
  "outreach_message": "mensagem WhatsApp humana e personalizada, máx 200 chars, português informal",
  "confidence_score": 0-100
}`;

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
