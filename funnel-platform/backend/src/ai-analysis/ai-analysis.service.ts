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

    return `Você é um especialista em automação e IA que entende profundamente CADA tipo de negócio. Sua tarefa é analisar este perfil de Instagram ESPECÍFICO e gerar insights que DEMONSTREM que você realmente entendeu:
- EXATAMENTE o que essa pessoa vende
- COMO ela vende (seu método específico)
- QUAL é o seu maior gargalo operacional
- COMO IA resolve especificamente esse gargalo

PERFIL A ANALISAR:
Nome: ${name}
Instagram: ${instagram}
Bio: "${biography}"
Seguidores: ${followers.toLocaleString()} | Engajamento: ${engagementPercent}%

POSTS RECENTES:
${postsData}

⚠️ REGRA CRÍTICA:
- NÃO repita templates genéricos (tipo "automação inteligente", "otimizar funil", "taxa de conversão")
- CITE ESPECIFICAMENTE palavras/conceitos da BIO e POSTS dela
- RECONHEÇA o diferencial ÚNICO dela (prova social, timing, promises específicas, etc)
- A resposta deve mostrar que você LEU e ENTENDEU esse Instagram específico, não um template

EXEMPLOS DE ANÁLISE REAL (boa):
Para bio "Rejuvenescimento facial natural • 46mil mulheres • 40 dias • 5min/dia":
- selling_angle: "Qualificar leads que veem 'antes/depois' — muitos clicam mas têm dúvidas sobre tempo/esforço"
- outreach: "Vi sua abordagem dos 5min/dia funcionando — qual % dessas visualizações vira cliente?"

Para bio "Advocacia especializada em direito civil":
- selling_angle: "Classificar automaticamente consultas por urgência — economiza seu tempo inicial"
- outreach: "Vejo seu Instagram gerando demanda — automação pode filtrar leads que realmente fecham"

Gere um JSON SIMPLES e DIRETO:
{
  "niche": "${niche}",
  "engagement_level": "baixo/médio/alto + número real",
  "audience_profile": "descrição concreta (ex: mulheres 30-50 inseguras com envelhecimento, buscando alternativa a procedimentos)",
  "content_pattern": "padrão específico visto (ex: storytelling emocional + antes/depois + provas sociais de clientes)",
  "selling_angle": "gargalo específico deste negócio + solução (máx 100 chars)",
  "outreach_message": "reconheça algo específico da bio/posts + pergunta que mostra você entendeu (máx 180 chars, português)",
  "confidence_score": "0-100"
}

Responda APENAS o JSON, sem formatação markdown, sem texto extra.`;
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
