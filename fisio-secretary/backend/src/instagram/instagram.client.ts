import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

// Chamadas à API do Instagram (login do Instagram, host graph.instagram.com) — mesmo fluxo
// que já roda no convertHairCRM. O token vai sempre como parâmetro e nunca entra em mensagem
// de erro.
//
// Versão fixa, trocável por IG_GRAPH_VERSION no Railway sem deploy: a Meta aposenta versões
// e URL sem versão cai na versão antiga do app (foi o que derrubou o relatório de tráfego em
// 16/11/2026). v25.0 é a versão em que os webhooks do app CRM-IA estão assinados.
@Injectable()
export class InstagramClient {
  private static readonly DEFAULT_VERSION = 'v25.0';

  constructor(private readonly config: ConfigService, private readonly http: HttpService) {}

  private base(): string {
    const v = (this.config.get<string>('IG_GRAPH_VERSION') ?? '').trim() || InstagramClient.DEFAULT_VERSION;
    return `https://graph.instagram.com/${v}`;
  }

  private async call<T = any>(method: 'get' | 'post' | 'delete', path: string, token: string, params: Record<string, any> = {}, body?: any): Promise<T> {
    try {
      const url = path.startsWith('http') ? path : `${this.base()}${path}`;
      const cfg = { params: { ...params, access_token: token }, timeout: 20000 };
      const res = method === 'post'
        ? await firstValueFrom(this.http.post(url, body ?? {}, cfg))
        : method === 'delete'
          ? await firstValueFrom(this.http.delete(url, cfg))
          : await firstValueFrom(this.http.get(url, cfg));
      return res.data as T;
    } catch (err: any) {
      const metaMsg = err?.response?.data?.error?.message;
      throw new Error(metaMsg ? `Instagram: ${metaMsg}` : `Instagram: ${err.message}`);
    }
  }

  // user_id = id da conta profissional (o mesmo do entry.id dos webhooks).
  async me(token: string): Promise<{ igUserId: string; username: string | null }> {
    const d = await this.call('get', '/me', token, { fields: 'user_id,username' });
    return { igUserId: String(d.user_id ?? d.id), username: d.username ?? null };
  }

  // Liga a "assinatura do webhook" da conta (o mesmo toggle do painel da Meta).
  subscribe(igUserId: string, token: string) {
    return this.call('post', `/${igUserId}/subscribed_apps`, token, { subscribed_fields: 'comments,messages' });
  }

  unsubscribe(igUserId: string, token: string) {
    return this.call('delete', `/${igUserId}/subscribed_apps`, token);
  }

  listMedia(igUserId: string, token: string, after?: string) {
    return this.call('get', `/${igUserId}/media`, token, {
      fields: 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp',
      limit: 12,
      ...(after ? { after } : {}),
    });
  }

  // Resposta privada a um comentário: única forma de mandar a 1ª mensagem a quem nunca falou
  // com a conta (por id da pessoa a Meta recusa com 403).
  sendToComment(igUserId: string, token: string, commentId: string, message: any) {
    return this.call('post', `/${igUserId}/messages`, token, {}, { recipient: { comment_id: commentId }, message });
  }

  sendToUser(igUserId: string, token: string, recipientId: string, message: any) {
    return this.call('post', `/${igUserId}/messages`, token, {}, { recipient: { id: recipientId }, message });
  }

  replyToComment(commentId: string, token: string, message: string) {
    return this.call('post', `/${commentId}/replies`, token, {}, { message });
  }

  async username(igsid: string, token: string): Promise<string | null> {
    try {
      const d = await this.call('get', `/${igsid}`, token, { fields: 'username' });
      return d?.username ?? null;
    } catch {
      return null;
    }
  }

  // Token de 60 dias: renova por mais 60 (precisa ter mais de 24h e ainda valer).
  async refresh(token: string): Promise<{ token: string; expiresInSec: number }> {
    const d = await this.call('get', 'https://graph.instagram.com/refresh_access_token', token, { grant_type: 'ig_refresh_token' });
    return { token: d.access_token, expiresInSec: Number(d.expires_in ?? 0) };
  }
}
