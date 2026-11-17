import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

// Leitura de métricas na API de Marketing da Meta. SÓ LEITURA: este client não tem (e não
// deve ganhar) nenhum método que crie, pause ou altere campanha/orçamento.
//
// Token: META_ADS_TOKEN (token de usuário do sistema do portfólio empresarial, com
// permissão ads_read nas contas dos clientes). É diferente do WHATSAPP_TOKEN, que é da
// Cloud API do WhatsApp e não enxerga anúncios.
@Injectable()
export class MetaAdsClient {
  constructor(private readonly config: ConfigService, private readonly http: HttpService) {}

  isConfigured(): boolean {
    return !!this.config.get<string>('META_ADS_TOKEN');
  }

  // Sem versão fixa por padrão: a Meta aposenta versões da API de Marketing em cerca de um
  // ano, e versão vencida derruba a rotina inteira. Sem versão na URL, a Meta usa a mais
  // antiga ainda válida para o app. META_GRAPH_VERSION (ex: "v24.0") fixa uma, se preciso.
  private baseUrl(): string {
    const version = (this.config.get<string>('META_GRAPH_VERSION') ?? '').trim();
    return version ? `https://graph.facebook.com/${version}` : 'https://graph.facebook.com';
  }

  private async insights(adAccountId: string, params: Record<string, string>): Promise<any[]> {
    const token = this.config.get<string>('META_ADS_TOKEN');
    if (!token) throw new Error('META_ADS_TOKEN não configurado');
    try {
      const res = await firstValueFrom(
        this.http.get(`${this.baseUrl()}/act_${adAccountId}/insights`, {
          // use_unified_attribution_setting = mesmos números que o Gerenciador de Anúncios mostra.
          params: { ...params, use_unified_attribution_setting: 'true', limit: '100' },
          headers: { Authorization: `Bearer ${token}` },
          timeout: 30000,
        }),
      );
      return Array.isArray(res.data?.data) ? res.data.data : [];
    } catch (err: any) {
      // A mensagem de erro da Meta é o que permite corrigir (token vencido, conta sem
      // permissão). O token nunca entra na mensagem: ele só vai no header.
      const metaMsg = err?.response?.data?.error?.message;
      throw new Error(metaMsg ? `Meta: ${metaMsg}` : `Meta: ${err.message}`);
    }
  }

  // Totais da conta no período (uma linha só; vazio = não veiculou).
  async accountTotals(adAccountId: string, period: { since: string; until: string }): Promise<any | undefined> {
    const rows = await this.insights(adAccountId, {
      level: 'account',
      time_range: JSON.stringify(period),
      fields: 'spend,impressions,reach,frequency,ctr,cpm,actions',
    });
    return rows[0];
  }

  // Uma linha por anúncio que veiculou no período.
  async adBreakdown(adAccountId: string, period: { since: string; until: string }): Promise<any[]> {
    return this.insights(adAccountId, {
      level: 'ad',
      time_range: JSON.stringify(period),
      fields: 'ad_name,spend,actions',
    });
  }
}
