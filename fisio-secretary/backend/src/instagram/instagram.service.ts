import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, MoreThan, Not, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { InstagramAccount } from '../common/entities/instagram-account.entity';
import { InstagramAutomation } from '../common/entities/instagram-automation.entity';
import { InstagramEvent, InstagramEventAction } from '../common/entities/instagram-event.entity';
import { WhatsappConfig } from '../common/entities/whatsapp-config.entity';
import { decryptSecret, encryptSecret, SecretBoxKeyMissingError } from '../common/utils/secret-box';
import { InstagramClient } from './instagram.client';
import {
  BUTTON_LABEL_MAX, BUTTON_TEXT_MAX, InstagramInboundEvent, buildDmMessage, buildWhatsappLink,
  commentMatches, extractInstagramEvents, normalizeWhatsappPhone, parseKeywords, renderTemplate,
} from './instagram.util';

const TZ = 'America/Sao_Paulo';
const DAY_MS = 24 * 60 * 60 * 1000;
const TOKEN_TTL_DAYS = 60;
const REFRESH_AFTER_DAYS = 20; // renova bem antes dos 60 dias

// Automação de Instagram por cliente: comentário num post configurado ou Direct → Direct com
// botão para o WhatsApp do cliente. Os eventos chegam repassados pelo convertHairCRM (o app
// CRM-IA da Meta tem um webhook só, que aponta para lá — ver instagram.controller.ts).
@Injectable()
export class InstagramService {
  private readonly logger = new Logger(InstagramService.name);

  constructor(
    @InjectRepository(InstagramAccount) private readonly accountRepo: Repository<InstagramAccount>,
    @InjectRepository(InstagramAutomation) private readonly automationRepo: Repository<InstagramAutomation>,
    @InjectRepository(InstagramEvent) private readonly eventRepo: Repository<InstagramEvent>,
    @InjectRepository(WhatsappConfig) private readonly configRepo: Repository<WhatsappConfig>,
    private readonly ig: InstagramClient,
    private readonly config: ConfigService,
    private readonly http: HttpService,
  ) {}

  // ───────────────────────── Webhook ─────────────────────────

  async handleWebhook(body: any): Promise<void> {
    for (const ev of extractInstagramEvents(body)) {
      try {
        await this.processEvent(ev);
      } catch (err: any) {
        this.logger.error(`[IG] Erro ao processar ${ev.kind} ${ev.externalId}: ${err.message}`);
      }
    }
  }

  async processEvent(ev: InstagramInboundEvent): Promise<InstagramEventAction | null> {
    const account = await this.accountRepo.findOne({ where: { igUserId: ev.accountIgId, active: true } });
    if (!account) return null; // conta não conectada aqui
    if (ev.senderIgId === account.igUserId) return null; // a própria conta (evita loop com a resposta pública)

    // Trava contra evento repetido: a Meta reenvia webhook. external_id é único.
    let row: InstagramEvent;
    try {
      row = await this.eventRepo.save(this.eventRepo.create({
        tenantId: account.tenantId,
        kind: ev.kind,
        externalId: ev.externalId,
        senderIgId: ev.senderIgId,
        senderUsername: ev.kind === 'comment' ? ev.senderUsername : null,
        postId: ev.kind === 'comment' ? ev.mediaId : null,
        text: (ev.text ?? '').slice(0, 2000),
        action: 'received',
      }));
    } catch (err: any) {
      if (err?.code === '23505') return null;
      throw err;
    }

    const finish = async (action: InstagramEventAction, extra: Partial<InstagramEvent> = {}) => {
      await this.eventRepo.update(row.id, { action, ...extra });
      return action;
    };

    let token: string;
    try {
      token = decryptSecret(account.tokenEnc);
    } catch (err: any) {
      await this.accountRepo.update(account.id, { lastError: `Token ilegível: ${err.message}` });
      return finish('failed', { error: 'Token ilegível (INTEGRATIONS_ENC_KEY mudou?)' });
    }

    if (ev.kind === 'comment') {
      const automations = await this.automationRepo.find({ where: { tenantId: account.tenantId, postId: ev.mediaId, active: true }, order: { createdAt: 'ASC' } });
      const auto = automations.find((a) => commentMatches(a.triggerMode, a.keywords, ev.text));
      if (!auto) return finish('no_match');
      if (await this.inCooldown(account, ev.senderIgId, row.id)) return finish('cooldown', { automationId: auto.id });

      const link = buildWhatsappLink(auto.whatsappPhone || account.whatsappPhone, auto.whatsappText);
      const message = buildDmMessage(renderTemplate(auto.dmText, ev.senderUsername), auto.buttonLabel, link);
      try {
        await this.ig.sendToComment(account.igUserId, token, ev.externalId, message);
      } catch (err: any) {
        await this.accountRepo.update(account.id, { lastError: err.message });
        return finish('failed', { automationId: auto.id, error: err.message });
      }
      if (auto.commentReply?.trim()) {
        // Resposta pública é bônus: se falhar, o Direct já foi.
        await this.ig.replyToComment(ev.externalId, token, renderTemplate(auto.commentReply, ev.senderUsername))
          .catch((err) => this.logger.warn(`[IG] Resposta pública falhou (${account.username}): ${err.message}`));
      }
      await this.automationRepo.increment({ id: auto.id }, 'triggeredCount', 1);
      this.logger.log(`[IG] Comentário de @${ev.senderUsername ?? ev.senderIgId} → Direct enviado (${account.username}, automação ${auto.id})`);
      return finish('sent', { automationId: auto.id });
    }

    // Direct
    if (!account.dmEnabled || !account.dmText?.trim()) return finish('disabled');
    if (await this.inCooldown(account, ev.senderIgId, row.id)) return finish('cooldown');

    const username = /\{nome\}/i.test(account.dmText) ? await this.ig.username(ev.senderIgId, token) : null;
    if (username) await this.eventRepo.update(row.id, { senderUsername: username });
    const link = buildWhatsappLink(account.whatsappPhone, account.dmWhatsappText);
    const message = buildDmMessage(renderTemplate(account.dmText, username), account.dmButtonLabel, link);
    try {
      await this.ig.sendToUser(account.igUserId, token, ev.senderIgId, message);
    } catch (err: any) {
      await this.accountRepo.update(account.id, { lastError: err.message });
      return finish('failed', { error: err.message });
    }
    this.logger.log(`[IG] Direct de ${username ? '@' + username : ev.senderIgId} → resposta enviada (${account.username})`);
    return finish('sent');
  }

  // Quem já recebeu mensagem automática dentro do intervalo não recebe outra — evita mandar
  // o mesmo Direct a cada comentário ou a cada "obrigada" que a pessoa responder.
  private async inCooldown(account: InstagramAccount, senderIgId: string, currentEventId: string): Promise<boolean> {
    const hours = Math.max(0, account.cooldownHours ?? 24);
    if (hours === 0) return false;
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const count = await this.eventRepo.count({
      where: { tenantId: account.tenantId, senderIgId, action: 'sent', createdAt: MoreThan(since), id: Not(currentEventId) },
    });
    return count > 0;
  }

  // ───────────────────────── Admin: conexão da conta ─────────────────────────

  async adminStatus(tenantId: string) {
    const a = await this.accountRepo.findOne({ where: { tenantId } });
    if (!a) return { connected: false };
    return {
      connected: a.active,
      username: a.username,
      igUserId: a.igUserId,
      tokenExpiresAt: a.tokenExpiresAt,
      tokenRefreshedAt: a.tokenRefreshedAt,
      lastError: a.lastError,
      whatsappPhone: a.whatsappPhone,
    };
  }

  // Valida o token na Meta, liga a assinatura do webhook da conta e guarda criptografado.
  async connect(tenantId: string, rawToken: string) {
    const token = (rawToken ?? '').trim();
    if (token.length < 30) throw new BadRequestException('Cole o token completo do Instagram.');
    const tenant = await this.configRepo.findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Cliente não encontrado');

    let me: { igUserId: string; username: string | null };
    try {
      me = await this.ig.me(token);
    } catch (err: any) {
      throw new BadRequestException(`O Instagram recusou o token: ${err.message}`);
    }
    const other = await this.accountRepo.findOne({ where: { igUserId: me.igUserId } });
    if (other && other.tenantId !== tenantId) throw new BadRequestException(`A conta @${me.username} já está conectada em outro cliente.`);

    let tokenEnc: string;
    try {
      tokenEnc = encryptSecret(token);
    } catch (err) {
      if (err instanceof SecretBoxKeyMissingError) throw new BadRequestException(err.message);
      throw err;
    }

    let lastError: string | null = null;
    try {
      await this.ig.subscribe(me.igUserId, token);
    } catch (err: any) {
      lastError = `Assinatura do webhook falhou: ${err.message}`;
    }

    const existing = await this.accountRepo.findOne({ where: { tenantId } });
    const row = existing ?? this.accountRepo.create({ tenantId, whatsappPhone: normalizeWhatsappPhone(tenant.phone) || null });
    Object.assign(row, {
      igUserId: me.igUserId,
      username: me.username,
      tokenEnc,
      tokenRefreshedAt: new Date(),
      tokenExpiresAt: new Date(Date.now() + TOKEN_TTL_DAYS * DAY_MS),
      active: true,
      lastError,
    });
    await this.accountRepo.save(row);
    this.logger.log(`[IG] Conta @${me.username} conectada ao tenant ${tenantId}${lastError ? ` (aviso: ${lastError})` : ''}`);
    return this.adminStatus(tenantId);
  }

  async test(tenantId: string) {
    const a = await this.accountRepo.findOne({ where: { tenantId } });
    if (!a) return { ok: false, error: 'Nenhuma conta conectada' };
    try {
      const me = await this.ig.me(decryptSecret(a.tokenEnc));
      return { ok: true, username: me.username };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  async disconnect(tenantId: string) {
    const a = await this.accountRepo.findOne({ where: { tenantId } });
    if (!a) return { ok: true };
    try {
      await this.ig.unsubscribe(a.igUserId, decryptSecret(a.tokenEnc));
    } catch (err: any) {
      this.logger.warn(`[IG] Não deu para tirar a assinatura do webhook de @${a.username}: ${err.message}`);
    }
    await this.accountRepo.delete(a.id); // automações ficam guardadas para uma reconexão
    return { ok: true };
  }

  // ───────────────────────── Tela da cliente ─────────────────────────

  private async requireAccount(tenantId: string): Promise<InstagramAccount> {
    const a = await this.accountRepo.findOne({ where: { tenantId, active: true } });
    if (!a) throw new BadRequestException('Instagram não conectado. Fale com o suporte para conectar.');
    return a;
  }

  async status(tenantId: string) {
    const a = await this.accountRepo.findOne({ where: { tenantId } });
    if (!a) return { connected: false };
    return {
      connected: a.active,
      username: a.username,
      tokenExpiresAt: a.tokenExpiresAt,
      lastError: a.lastError,
      settings: {
        whatsappPhone: a.whatsappPhone ?? '',
        dmEnabled: a.dmEnabled,
        dmText: a.dmText,
        dmButtonLabel: a.dmButtonLabel,
        dmWhatsappText: a.dmWhatsappText,
        cooldownHours: a.cooldownHours,
      },
    };
  }

  async updateSettings(tenantId: string, body: any) {
    const a = await this.requireAccount(tenantId);
    if (body.whatsappPhone !== undefined) a.whatsappPhone = normalizeWhatsappPhone(body.whatsappPhone) || null;
    if (body.dmEnabled !== undefined) a.dmEnabled = !!body.dmEnabled;
    if (body.dmText !== undefined) a.dmText = this.text(body.dmText, BUTTON_TEXT_MAX, 'Mensagem do Direct');
    if (body.dmButtonLabel !== undefined) a.dmButtonLabel = this.label(body.dmButtonLabel);
    if (body.dmWhatsappText !== undefined) a.dmWhatsappText = this.text(body.dmWhatsappText, 300, 'Mensagem do WhatsApp');
    if (body.cooldownHours !== undefined) {
      const h = Number(body.cooldownHours);
      if (!Number.isFinite(h) || h < 0 || h > 24 * 30) throw new BadRequestException('Intervalo inválido (0 a 720 horas).');
      a.cooldownHours = Math.round(h);
    }
    if (a.dmEnabled && !a.dmText.trim()) throw new BadRequestException('Escreva a mensagem do Direct antes de ligar.');
    await this.accountRepo.save(a);
    return this.status(tenantId);
  }

  async listMedia(tenantId: string, after?: string) {
    const a = await this.requireAccount(tenantId);
    try {
      const res = await this.ig.listMedia(a.igUserId, decryptSecret(a.tokenEnc), after);
      return {
        data: (res?.data ?? []).map((m: any) => ({
          id: m.id,
          caption: m.caption ?? '',
          mediaType: m.media_type,
          thumbnail: m.thumbnail_url ?? m.media_url ?? null,
          permalink: m.permalink ?? null,
          timestamp: m.timestamp ?? null,
        })),
        after: res?.paging?.next ? res?.paging?.cursors?.after ?? null : null,
      };
    } catch (err: any) {
      throw new BadRequestException(`Não deu para buscar os posts: ${err.message}`);
    }
  }

  listAutomations(tenantId: string) {
    return this.automationRepo.find({ where: { tenantId }, order: { createdAt: 'DESC' } });
  }

  async saveAutomation(tenantId: string, body: any, id?: string) {
    await this.requireAccount(tenantId);
    const row = id
      ? await this.automationRepo.findOne({ where: { id, tenantId } })
      : this.automationRepo.create({ tenantId });
    if (!row) throw new NotFoundException('Automação não encontrada');

    if (!id || body.postId !== undefined) {
      const postId = String(body.postId ?? '').trim();
      if (!postId) throw new BadRequestException('Escolha o post.');
      row.postId = postId;
      row.postCaption = body.postCaption ? String(body.postCaption).slice(0, 2000) : null;
      row.postThumbnail = body.postThumbnail ? String(body.postThumbnail) : null;
      row.postPermalink = body.postPermalink ? String(body.postPermalink) : null;
    }
    if (!id || body.triggerMode !== undefined) row.triggerMode = body.triggerMode === 'any' ? 'any' : 'keyword';
    if (!id || body.keywords !== undefined) row.keywords = String(body.keywords ?? '').slice(0, 1000);
    if (row.triggerMode === 'keyword' && parseKeywords(row.keywords).length === 0) {
      throw new BadRequestException('Escreva pelo menos uma palavra-chave, ou escolha "qualquer comentário".');
    }
    if (!id || body.dmText !== undefined) row.dmText = this.text(body.dmText, BUTTON_TEXT_MAX, 'Mensagem do Direct', true);
    if (!id || body.buttonLabel !== undefined) row.buttonLabel = this.label(body.buttonLabel);
    if (!id || body.commentReply !== undefined) {
      const r = String(body.commentReply ?? '').trim();
      row.commentReply = r ? r.slice(0, 300) : null;
    }
    if (!id || body.whatsappPhone !== undefined) row.whatsappPhone = normalizeWhatsappPhone(body.whatsappPhone) || null;
    if (!id || body.whatsappText !== undefined) row.whatsappText = this.text(body.whatsappText ?? 'Oi! Vim pelo Instagram 😊', 300, 'Mensagem do WhatsApp');
    if (body.active !== undefined) row.active = !!body.active;
    return this.automationRepo.save(row);
  }

  async deleteAutomation(tenantId: string, id: string) {
    await this.automationRepo.delete({ id, tenantId });
    return { ok: true };
  }

  listEvents(tenantId: string, limit = 50) {
    return this.eventRepo.find({ where: { tenantId }, order: { createdAt: 'DESC' }, take: Math.min(Math.max(limit, 1), 200) });
  }

  private text(v: any, max: number, label: string, required = false): string {
    const s = String(v ?? '').trim();
    if (required && !s) throw new BadRequestException(`${label} é obrigatória.`);
    if (s.length > max) throw new BadRequestException(`${label}: no máximo ${max} caracteres.`);
    return s;
  }

  private label(v: any): string {
    const s = String(v ?? '').trim() || 'Falar no WhatsApp';
    if (s.length > BUTTON_LABEL_MAX) throw new BadRequestException(`Texto do botão: no máximo ${BUTTON_LABEL_MAX} caracteres (limite do Instagram).`);
    return s;
  }

  // ───────────────────────── Renovação do token ─────────────────────────

  // Token do Instagram vale 60 dias. Renova a cada ~20 dias. Só roda no Railway: o backend de
  // dev usa cópia do banco de produção e não deve girar o token real.
  @Cron('0 5 * * *', { timeZone: TZ })
  async refreshTokens(): Promise<void> {
    if (!process.env.RAILWAY_ENVIRONMENT_NAME && !process.env.RAILWAY_ENVIRONMENT) return;
    const due = await this.accountRepo.find({ where: { active: true, tokenRefreshedAt: LessThan(new Date(Date.now() - REFRESH_AFTER_DAYS * DAY_MS)) } });
    for (const a of due) {
      try {
        const r = await this.ig.refresh(decryptSecret(a.tokenEnc));
        if (!r.token) throw new Error('resposta sem token');
        await this.accountRepo.update(a.id, {
          tokenEnc: encryptSecret(r.token),
          tokenRefreshedAt: new Date(),
          tokenExpiresAt: new Date(Date.now() + (r.expiresInSec || TOKEN_TTL_DAYS * 86400) * 1000),
          lastError: null,
        });
        this.logger.log(`[IG] Token de @${a.username} renovado`);
      } catch (err: any) {
        await this.accountRepo.update(a.id, { lastError: `Renovação do token falhou: ${err.message}` });
        this.logger.error(`[IG] Renovação do token de @${a.username} falhou: ${err.message}`);
        await this.alertAdmin(`⚠️ *Instagram: token não renovado*\n\nConta @${a.username ?? a.igUserId}\nErro: ${err.message}\n\nSe vencer, a automação para. Gere um token novo no app CRM-IA e cole no card do Admin.`);
      }
    }
  }

  private async alertAdmin(text: string) {
    const phone = this.config.get<string>('ADMIN_ALERT_PHONE');
    const baseUrl = this.config.get<string>('UAZAPI_BASE_URL');
    const token = this.config.get<string>('BILLING_SENDER_TOKEN');
    if (!phone || !baseUrl || !token) return;
    await firstValueFrom(this.http.post(`${baseUrl}/send/text`, { number: phone, text }, { headers: { token }, timeout: 20000 }))
      .catch((err) => this.logger.error(`[IG] Falha ao avisar o admin: ${err.message}`));
  }
}
