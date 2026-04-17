import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { LeadsService } from '../leads/leads.service';
import { AiAnalysisService } from '../ai-analysis/ai-analysis.service';
import { Lead, EnrichmentData } from '../common/entities/lead.entity';

@Injectable()
export class EnrichmentService {
  private readonly logger = new Logger(EnrichmentService.name);
  private readonly rapidapiKey: string;
  private readonly rapidapiHost: string;

  constructor(
    private config: ConfigService,
    private leadsService: LeadsService,
    private aiAnalysisService: AiAnalysisService,
  ) {
    this.rapidapiKey = config.get('RAPIDAPI_KEY') || '';
    this.rapidapiHost = config.get('RAPIDAPI_HOST') || 'instagram120.p.rapidapi.com';
  }

  async enrichLeadFromInstagram(leadId: string): Promise<Lead> {
    const lead = await this.leadsService.findById(leadId);

    if (!lead.instagram) {
      this.logger.warn(`Lead ${leadId} não tem Instagram`);
      return lead;
    }

    try {
      const handle = lead.instagram.replace(/^@/, '');
      const enrichmentData = await this.fetchInstagramData(handle);
      const posts = await this.fetchInstagramPosts(handle);

      enrichmentData.posts = posts;

      const bonusScore = enrichmentData.enrichment_bonus || 0;
      const newScore = lead.score + bonusScore;

      const aiInsight = await this.aiAnalysisService.analyzeLeadInstagram(
        lead.name,
        lead.instagram,
        enrichmentData.followers || 0,
        enrichmentData.engagement_rate || 0,
        enrichmentData.content_type || '',
        posts,
      );

      const updated = await this.leadsService.update(leadId, {
        enrichmentData,
        aiInsight,
        score: newScore,
      });

      this.logger.log(`Lead ${leadId} enriquecido: +${bonusScore}pts (total: ${newScore})`);
      return updated;
    } catch (err) {
      this.logger.error(`Erro ao enriquecer lead ${leadId}: ${err.message}`);
      throw err;
    }
  }

  private async fetchInstagramData(handle: string): Promise<EnrichmentData> {
    try {
      const response = await axios.post(
        `https://${this.rapidapiHost}/api/instagram/profile`,
        { username: handle },
        {
          headers: {
            'x-rapidapi-key': this.rapidapiKey,
            'x-rapidapi-host': this.rapidapiHost,
            'Content-Type': 'application/json',
          },
        },
      );

      const data = response.data.result;
      const followers = data.edge_followed_by?.count || 0;
      const posts = data.edge_owner_to_timeline_media?.count || 0;

      return {
        followers,
        engagement_rate: followers > 0 ? posts / followers : 0,
        content_type: data.biography || '',
        recent_stories: [],
        enrichment_bonus: 0,
      };
    } catch (err: any) {
      this.logger.error(`RapidAPI error: ${err.message}`);
      throw new Error('Falha ao buscar dados do Instagram');
    }
  }

  private async fetchInstagramPosts(handle: string): Promise<any[]> {
    try {
      const response = await axios.post(
        `https://${this.rapidapiHost}/api/instagram/posts`,
        { username: handle, maxId: '' },
        {
          headers: {
            'x-rapidapi-key': this.rapidapiKey,
            'x-rapidapi-host': this.rapidapiHost,
            'Content-Type': 'application/json',
          },
        },
      );

      const edges = response.data.result?.edges || [];
      return edges.slice(0, 3).map((edge: any) => {
        const node = edge.node;
        const imageUrl = node.image_versions2?.candidates?.[0]?.url || '';
        return {
          code: node.code,
          caption: node.caption?.text || '',
          takenAt: node.taken_at,
          imageUrl,
          commentCount: node.comment_count || 0,
          likeCount: node.like_count || 0,
        };
      });
    } catch (err: any) {
      this.logger.error(`RapidAPI posts error: ${err.message}`);
      return [];
    }
  }

}
