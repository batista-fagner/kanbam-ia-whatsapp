import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { WhatsappConfig } from '../common/entities/whatsapp-config.entity';
import { OnboardingSettings } from '../common/entities/onboarding-settings.entity';
import { GroupMessage } from '../common/entities/group-message.entity';
import { GroupMonitorSettings } from '../common/entities/group-monitor-settings.entity';
import { AiService } from '../ai/ai.service';
import { UazapiProvider } from '../evolution/providers/uazapi.provider';

// Captura e classifica em tempo real as mensagens dos grupos "Projeto <cliente>" (criados
// por OnboardingService.createProjectGroup), recebidas pelo webhook dedicado da instância
// sender (ver GroupMonitorController). O relatório diário (resumo agregado) é gerado à parte
// por group-monitor-report.service.ts (cron 18h) — este service só grava mensagem por
// mensagem e dispara o alerta de risco imediato.
@Injectable()
export class GroupMonitorService {
  private readonly logger = new Logger(GroupMonitorService.name);

  // Dedup de mensagem duplicada (uazapi reenvia webhook às vezes) — mesmo padrão do
  // EvolutionController, escopado só a este fluxo.
  private readonly processedIds = new Set<string>();

  // Cache de LID→telefone por grupo (confirmado em produção 2026-09-14: em grupos com
  // AddressingMode=lid a uazapi manda "sender" como "<lid>@lid", não o telefone real —
  // precisa resolver via POST /group/info. TTL 10min por groupJid pra não bater na API a
  // cada mensagem, mas ainda pegar gente nova entrando no grupo.
  private readonly lidMapCache = new Map<string, { map: Map<string, string>; expiresAt: number }>();

  constructor(
    @InjectRepository(WhatsappConfig) private readonly configRepo: Repository<WhatsappConfig>,
    @InjectRepository(OnboardingSettings) private readonly onboardingSettingsRepo: Repository<OnboardingSettings>,
    @InjectRepository(GroupMessage) private readonly messageRepo: Repository<GroupMessage>,
    @InjectRepository(GroupMonitorSettings) private readonly settingsRepo: Repository<GroupMonitorSettings>,
    private readonly config: ConfigService,
    private readonly http: HttpService,
    private readonly aiService: AiService,
    private readonly uazapiProvider: UazapiProvider,
  ) {}

  // ───────────────────────── Configuração (linha única) ─────────────────────────

  async getSettings(): Promise<GroupMonitorSettings> {
    let settings = await this.settingsRepo.findOne({ where: { id: 1 } });
    if (!settings) {
      settings = await this.settingsRepo.save(this.settingsRepo.create({ id: 1 }));
    }
    return settings;
  }

  async updateSettings(body: { riskAlertPhone?: string | null }): Promise<GroupMonitorSettings> {
    const settings = await this.getSettings();
    if (body.riskAlertPhone !== undefined) {
      const digits = (body.riskAlertPhone ?? '').replace(/\D/g, '');
      settings.riskAlertPhone = digits || null;
    }
    return this.settingsRepo.save(settings);
  }

  // ───────────────────────── Ingestão de mensagem (webhook) ─────────────────────────

  // Chamado fire-and-forget pelo controller (nunca deve derrubar o webhook).
  async ingestMessage(body: any): Promise<void> {
    const message = body?.message;
    if (!message) return;

    const externalId: string | undefined = message.messageid ?? message.id;
    if (externalId) {
      if (this.processedIds.has(externalId)) return;
      this.processedIds.add(externalId);
      setTimeout(() => this.processedIds.delete(externalId), 5 * 60 * 1000);
    }

    // Nomes de campo palpitados pelo formato já usado no fluxo 1:1 (message.messageid,
    // body.chat.phone) — a uazapi nunca mandou um payload de grupo antes (descartado sem
    // logar). Fallback defensivo; ajustar aqui se o teste real (ver plano, passo 1 da
    // verificação) mostrar nomes diferentes.
    const groupJid: string | undefined =
      message.chatid ?? body?.chat?.id ?? message.chat?.id ?? message.key?.remoteJid;
    if (!groupJid) {
      this.logger.warn('[GROUP-MONITOR] Mensagem de grupo sem groupJid identificável — payload: ' + JSON.stringify(body).slice(0, 500));
      return;
    }

    const tenant = await this.configRepo.findOne({ where: { onboardingGroupJid: groupJid } });
    if (!tenant) return; // grupo que a instância porventura esteja, mas não é um "Projeto X" nosso

    const rawSender: string = message.sender ?? message.participant ?? message.key?.participant ?? '';
    const resolvedSender = await this._resolveSenderPhone(rawSender, groupJid);
    const senderPhone = this._normalizePhone(resolvedSender);
    const senderName: string | null = message.senderName ?? message.pushName ?? null;

    const { messageType, content } = await this._extractContent(message);
    if (content === null) return; // tipo não suportado (reação, sticker sem texto, etc)

    const onboardingSettings = await this.onboardingSettingsRepo.findOne({ where: { id: 1 } });
    const senderRole = this._resolveSenderRole(senderPhone, tenant.billingPhone, onboardingSettings?.teamPhones ?? []);

    const saved = await this.messageRepo.save(this.messageRepo.create({
      tenantId: tenant.id,
      groupJid,
      senderPhone: senderPhone || null,
      senderName,
      senderRole,
      messageType,
      content,
      externalMessageId: externalId ?? null,
    }));

    this.logger.log(`[GROUP-MONITOR] Mensagem capturada (tenant ${tenant.id}, ${senderRole}, ${messageType}): "${content.slice(0, 80)}"`);

    // Classificação de risco em tempo real — não bloqueia a ingestão, roda em paralelo.
    this._classifyAndAlert(tenant, saved).catch((err) =>
      this.logger.error(`[GROUP-MONITOR] Falha na classificação de risco: ${err.message}`));
  }

  private async _extractContent(message: any): Promise<{ messageType: GroupMessage['messageType']; content: string | null }> {
    const isAudio = message.type === 'media' && ['audio', 'ptt', 'myaudio'].includes(message.mediaType);
    const isImage = message.type === 'media' && message.mediaType === 'image';

    if (isAudio) {
      const senderToken = await this._resolveSenderToken();
      try {
        const transcription = await this.uazapiProvider.transcribeAudio(message.messageid, senderToken);
        return { messageType: 'audio', content: transcription || '[áudio sem transcrição]' };
      } catch (err: any) {
        this.logger.warn(`[GROUP-MONITOR] Falha ao transcrever áudio: ${err.message}`);
        return { messageType: 'audio', content: '[áudio — falha na transcrição]' };
      }
    }
    if (isImage) {
      return { messageType: 'image', content: '[imagem]' };
    }
    if (typeof message.text === 'string' && message.text.trim()) {
      return { messageType: 'text', content: message.text.trim() };
    }
    return { messageType: 'other', content: null };
  }

  // Resolve "<lid>@lid" pro telefone real via POST /group/info (grupos com
  // AddressingMode=lid não trazem o telefone direto na mensagem — confirmado em
  // produção). Se o sender já vier como telefone normal (@s.whatsapp.net), retorna como
  // está, sem chamada extra. Falha na resolução não quebra a ingestão — cai em 'unknown'.
  private async _resolveSenderPhone(rawSender: string, groupJid: string): Promise<string> {
    if (!rawSender.includes('@lid')) return rawSender;

    const cached = this.lidMapCache.get(groupJid);
    let map = cached && cached.expiresAt > Date.now() ? cached.map : null;

    if (!map) {
      map = await this._fetchLidMap(groupJid);
      this.lidMapCache.set(groupJid, { map, expiresAt: Date.now() + 10 * 60 * 1000 });
    }

    return map.get(rawSender) ?? '';
  }

  private async _fetchLidMap(groupJid: string): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    try {
      const baseUrl = this.config.get<string>('UAZAPI_BASE_URL') ?? '';
      const token = await this._resolveSenderToken();
      const res = await firstValueFrom(
        this.http.post(`${baseUrl}/group/info`, { groupjid: groupJid }, { headers: { token } }),
      );
      const participants: any[] = res.data?.Participants ?? [];
      for (const p of participants) {
        if (p.JID?.includes('@lid') && p.PhoneNumber) map.set(p.JID, p.PhoneNumber);
      }
    } catch (err: any) {
      this.logger.warn(`[GROUP-MONITOR] Falha ao resolver LID do grupo ${groupJid}: ${err.message}`);
    }
    return map;
  }

  // 'unknown' quando não bate com o telefone de cobrança do cliente nem com a equipe —
  // acontece por ex. quando o número salvo em billingPhone é diferente do que a pessoa usa
  // de fato no grupo (não trava nada, só fica sem role definido no transcript).
  private _resolveSenderRole(senderPhone: string, billingPhone: string | null, teamPhones: string[]): GroupMessage['senderRole'] {
    if (!senderPhone) return 'unknown';
    if (billingPhone && this._normalizePhone(billingPhone) === senderPhone) return 'client';
    if (teamPhones.some((p) => this._normalizePhone(p) === senderPhone)) return 'team';
    return 'unknown';
  }

  // ───────────────────────── Classificação de risco ─────────────────────────

  private async _classifyAndAlert(tenant: WhatsappConfig, message: GroupMessage): Promise<void> {
    // Filtro de custo: pula mensagem de texto trivial (sem chamar IA). Áudio sempre roda —
    // costuma ser conteúdo relevante quando alguém se dá ao trabalho de gravar.
    if (message.messageType === 'text' && message.content.replace(/[\p{Emoji}\s.,!?]/gu, '').length < 4) {
      return;
    }

    const recentContext = (await this.messageRepo.find({
      where: { groupJid: message.groupJid },
      order: { createdAt: 'DESC' },
      take: 6,
    })).reverse().slice(0, -1).map((m) => `[${m.senderRole === 'client' ? 'Cliente' : m.senderRole === 'team' ? 'Equipe' : '?'}] ${m.content}`);

    const { risk, reason } = await this.aiService.classifyGroupMessageRisk(message.content, recentContext);
    if (!risk) return;

    message.riskFlagged = true;
    message.riskReason = reason;
    await this.messageRepo.save(message);

    await this._alertRisk(tenant, message, reason);
  }

  private async _alertRisk(tenant: WhatsappConfig, message: GroupMessage, reason: string): Promise<void> {
    const settings = await this.getSettings();
    if (!settings.riskAlertPhone) {
      this.logger.warn(`[GROUP-MONITOR] Risco detectado (tenant ${tenant.displayName ?? tenant.id}) mas nenhum número de alerta configurado — confira "Relatórios de Grupos" no Admin.`);
      return;
    }
    const text = `🔴 *Sinal de risco detectado*\n\nCliente: *${tenant.displayName ?? tenant.id}*\nMotivo: ${reason}\n\nMensagem: "${message.content.slice(0, 300)}"`;
    await this._sendText(settings.riskAlertPhone, text);
  }

  // ───────────────────────── uazapi (mesmo padrão de OnboardingService) ─────────────────────────

  private async _resolveSenderToken(): Promise<string> {
    const envToken = this.config.get<string>('BILLING_SENDER_TOKEN');
    if (envToken) return envToken;
    const senderTenantId = this.config.get<string>('BILLING_SENDER_TENANT_ID');
    if (senderTenantId) {
      const sc = await this.configRepo.findOne({ where: { id: senderTenantId } });
      if (sc?.instanceToken) return sc.instanceToken;
    }
    return this.config.get<string>('UAZAPI_TOKEN') ?? '';
  }

  private async _sendText(numberOrJid: string, text: string): Promise<boolean> {
    const baseUrl = this.config.get<string>('UAZAPI_BASE_URL') ?? '';
    const token = await this._resolveSenderToken();
    try {
      await firstValueFrom(
        this.http.post(`${baseUrl}/send/text`, { number: numberOrJid, text }, { headers: { token } }),
      );
      return true;
    } catch (err: any) {
      this.logger.error(`[GROUP-MONITOR] Falha ao enviar alerta para ${numberOrJid} [HTTP ${err?.response?.status ?? 'N/A'}]: ${err.message}`);
      return false;
    }
  }

  private _normalizePhone(phone: string): string {
    const digits = String(phone ?? '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('55')) return digits;
    if (digits.length === 10 || digits.length === 11) return `55${digits}`;
    return digits;
  }
}
