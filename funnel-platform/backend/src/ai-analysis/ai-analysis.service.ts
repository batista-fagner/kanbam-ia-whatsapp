import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { Post } from '../common/entities/lead.entity';

export type Niche = 'health' | 'ecommerce' | 'food' | 'services' | 'marketing' | 'education' | 'generic';

export interface LeadInsight {
  niche: Niche;
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

  private readonly NICHE_KEYWORDS: Record<Niche, string[]> = {
    health: [
      'fisio', 'clínica', 'médico', 'médica', 'saúde', 'odonto', 'dentist',
      'nutriç', 'psicólog', 'terapeut', 'ortoped', 'pediatr', 'cardiolog',
      'esteticist', 'dermatolog', 'biomédic', 'enfermei', 'farmac', 'hospital',
    ],
    ecommerce: [
      'loja', 'shop', 'store', 'moda', 'roupas', 'produtos', 'atacado',
      'varejo', 'boutique', 'e-commerce', 'ecommerce', 'vendas online',
    ],
    food: [
      'restaurante', 'café', 'confeitari', 'doceria', 'salgados', 'pizza',
      'hambúrgu', 'gastronom', 'culinári', 'bistrô', 'padaria', 'açaí',
      'delivery', 'chef', 'buffet',
    ],
    services: [
      'advocaci', 'advogad', 'contabilidade', 'contador', 'seguros',
      'financeiro', 'finanças', 'imóveis', 'imobiliária', 'corretor',
      'arquitet', 'engenhei', 'construç', 'reform',
    ],
    marketing: [
      'marketing', 'agência', 'agencia', 'tráfego', 'trafego', 'ads',
      'social media', 'conteúdo', 'copywriter', 'branding', 'designer',
      'criativo', 'digital',
    ],
    education: [
      'coach', 'mentor', 'cursо', 'curso', 'professor', 'educaç',
      'treinamento', 'aula', 'capacitaç', 'palest', 'consultoria',
    ],
    generic: [],
  };

  constructor(private config: ConfigService) {
    const apiKey = config.get('OPENAI_API_KEY');
    this.openai = new OpenAI({ apiKey });
  }

  private detectNiche(bio: string): Niche {
    const lower = bio.toLowerCase();
    for (const [niche, keywords] of Object.entries(this.NICHE_KEYWORDS) as [Niche, string[]][]) {
      if (niche === 'generic') continue;
      if (keywords.some(kw => lower.includes(kw))) return niche;
    }
    return 'generic';
  }

  private getNicheContext(niche: Niche): string {
    const contexts: Record<Niche, string> = {
      health: 'profissional de saúde (clínica, consultório, fisioterapia, etc) que vende serviços de consulta/atendimento',
      ecommerce: 'empreendedor de e-commerce que vende produtos online',
      food: 'dono de negócio de alimentação (restaurante, café, delivery, etc)',
      services: 'prestador de serviço B2B (advocacia, contabilidade, arquitetura, etc)',
      marketing: 'agência ou profissional de marketing/publicidade que vende serviços de marketing',
      education: 'educador, coach ou creator que vende cursos, mentorias ou formações',
      generic: 'empreendedor/negociante genérico',
    };
    return contexts[niche];
  }

  private getPromptByNiche(
    name: string,
    instagram: string,
    followers: number,
    engagementRate: number,
    biography: string,
    postsData: string,
    niche: Niche,
  ): string {
    const engagementPercent = (engagementRate * 100).toFixed(2);

    return `Você é um especialista em IA e automação para negócios digitais. Seu trabalho é analisar o perfil de Instagram de um ${this.getNicheContext(niche)} e gerar insights MUITO ESPECÍFICOS e PERSONALIZADOS sobre como IA pode potencializar esse negócio.

⚠️ IMPORTANTE: Gere respostas ÚNICAS e DINÂMICAS. Não use respostas genéricas. Analise:
1. O que especificamente essa pessoa vende (olhe a bio e posts)
2. Qual é o seu diferencial (promises específicas, prova social, urgência)
3. Qual é o maior gargalo de vendas para esse tipo de negócio
4. Como IA pode resolver ESPECIFICAMENTE esse gargalo

DADOS DO LEAD:
Nome: ${name}
Instagram: ${instagram}
Seguidores: ${followers.toLocaleString()}
Taxa de Engajamento: ${engagementPercent}%
Bio: "${biography}"

CONTEÚDO RECENTE:
${postsData}

TAREFA: Gere um JSON com análise PROFUNDA e ESPECÍFICA desse perfil:
{
  "niche": "${niche}",
  "engagement_level": "Nível (baixo/médio/alto) - justifique brevemente olhando os números",
  "audience_profile": "Descrição ESPECÍFICA do tipo de pessoa que segue (gênero, idade, problema que tem, etc)",
  "content_pattern": "Qual é o PADRÃO específico de conteúdo (não genérico - detalhe o que realmente está postando)",
  "selling_angle": "Qual é o PRINCIPAL gargalo desse tipo de negócio no Instagram e como IA resolve (máx 100 chars, específico)",
  "outreach_message": "Mensagem que RECONHEÇA especificamente o que vê no perfil dele, não genérica (máx 180 chars, português)",
  "confidence_score": "Confiança na análise (0-100)"
}

EXEMPLOS DO QUE EVITAR (genérico e ruim):
❌ "IA que otimiza cada etapa do seu funil"
❌ "Sua taxa de conversão pode triplicar"
❌ "Automação inteligente para seu negócio"

EXEMPLOS DO QUE FAZER (específico e bom):
✅ "Responder as 10 perguntas mais frequentes sobre resultados/timing/valor de forma automática"
✅ "Follow-up automático com quem visitou seu link mas não clicou no CTA"
✅ "Análise inteligente de qual conteúdo converte leads em clientes reais"

Responda APENAS com o JSON, sem markdown, sem explicações extras.`;
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
      const niche = this.detectNiche(biography);

      const postsData = posts
        .map(
          (p) =>
            `Post: "${p.caption.substring(0, 150)}..." | Curtidas: ${p.likeCount} | Comentários: ${p.commentCount}`,
        )
        .join('\n');

      const prompt = this.getPromptByNiche(
        name,
        instagram,
        followers,
        engagementRate,
        biography,
        postsData,
        niche,
      );

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
        return this.getDefaultInsight(niche);
      }
      const insight = JSON.parse(content) as LeadInsight;

      this.logger.log(`Lead ${name} analisado com sucesso - Nicho: ${niche}`);
      return insight;
    } catch (err: any) {
      this.logger.error(`Erro ao analisar lead: ${err.message}`);
      return this.getDefaultInsight(this.detectNiche(biography));
    }
  }

  private getDefaultInsight(niche: Niche = 'generic'): LeadInsight {
    const defaultMessages: Record<Niche, string> = {
      health: 'Olá! Vi seu perfil e achei interessante. Tenho uma solução que pode aumentar suas consultas automaticamente. Podemos conversar?',
      ecommerce: 'Oi! Vimos sua loja e a audiência que você tem. Temos uma solução que aumenta conversões em até 3x. Quer conhecer?',
      food: 'E aí! Vi seu negócio de alimentação crescendo. Temos uma forma de aumentar seus pedidos sem sobrecarregar a equipe. Posso te mostrar?',
      services: 'Olá! Vi seu trabalho e achei excelente. Temos uma solução que qualifica leads automaticamente. Quer conversar?',
      marketing: 'Oi! Vi que você trabalha com marketing. Temos uma automação que você mesmo pode usar como case com seus clientes.',
      education: 'Oi! Vi seu conteúdo de qualidade. Temos uma forma de converter seguidores em alunos/clientes automaticamente. Quer explorar?',
      generic: 'Olá! Vimos seu conteúdo e gostaríamos de conversar sobre uma oportunidade de crescimento com automação.',
    };

    return {
      niche,
      engagement_level: 'Dados insuficientes',
      audience_profile: 'Análise não disponível',
      content_pattern: 'Análise não disponível',
      selling_angle: 'Análise automática indisponível',
      outreach_message: defaultMessages[niche],
      confidence_score: 0,
    };
  }
}
