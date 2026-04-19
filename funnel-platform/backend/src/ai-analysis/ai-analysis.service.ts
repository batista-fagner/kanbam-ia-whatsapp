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
1. Abrir com parabéns/reconhecimento genuíno — elogie algo ESPECÍFICO (audiência, método, resultado, prova social)
2. Criar rapport mostrando que você realmente olhou o perfil dele
3. Transicionar naturalmente para o gargalo REAL do funil
4. Falar sobre FUNIL DE VENDAS com IA, não "chatbot" ou "automação genérica"
5. Máximo 3 frases curtas + 1 pergunta direta
6. Tom: caloroso, informal, confiante — como alguém que admira o trabalho e quer ajudar

ERROS COMUNS A EVITAR:
❌ "Imagine atender 24/7 com um chatbot"
❌ "Vamos explorar como a IA pode acelerar seu sucesso"
❌ "Parabéns pelo seu negócio!" (elogio genérico que vale para qualquer um)
❌ Qualquer frase que poderia ser enviada para qualquer pessoa

EXEMPLOS DO QUE FAZER:
✅ Para fisioterapeuta com 50k: "${firstName}, 50 mil seguidores num nicho tão concorrido como fisio é resultado de muito trabalho sério. Mas audiência assim costuma vazar no funil — leads que olham e somem. Já pensou em estruturar isso com IA?"
✅ Para e-commerce: "${firstName}, produto bom + conteúdo consistente como o seu é raro de ver. O problema quase sempre é o funil pós-clique. Já testou automação pra fechar quem visita mas não compra?"
✅ Para coach com prova social: "${firstName}, [X] alunos transformados é uma prova social poderosa. Com um funil com IA você consegue converter muito mais de quem já te segue. Quer ver como funciona?"

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
