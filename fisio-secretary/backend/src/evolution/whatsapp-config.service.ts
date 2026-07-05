import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { WhatsappConfig } from '../common/entities/whatsapp-config.entity';
import { UazapiProvider } from './providers/uazapi.provider';

@Injectable()
export class WhatsappConfigService {
  private readonly logger = new Logger(WhatsappConfigService.name);

  constructor(
    @InjectRepository(WhatsappConfig)
    private readonly repo: Repository<WhatsappConfig>,
    private readonly uazapi: UazapiProvider,
    private readonly config: ConfigService,
  ) {}

  async get(): Promise<WhatsappConfig | null> {
    const configs = await this.repo.find({ order: { createdAt: 'DESC' } });
    return configs[0] ?? null;
  }

  // Multi-tenant: tenantId === whatsapp_config.id
  async getByTenant(tenantId: string): Promise<WhatsappConfig | null> {
    if (!tenantId) return null;
    return this.repo.findOne({ where: { id: tenantId } });
  }

  async getTokenByTenant(tenantId: string): Promise<string> {
    const record = await this.getByTenant(tenantId);
    return record?.instanceToken || this.config.get('UAZAPI_TOKEN') || '';
  }

  async listAll(): Promise<WhatsappConfig[]> {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  // Cria um tenant NOVO (linha nova em whatsapp_config). NÃO reusa o existente.
  // A instância uazapi é conectada depois, pelo próprio tenant (tela de Settings).
  async createTenant(displayName: string, agentType = 'megahair'): Promise<WhatsappConfig> {
    const record = this.repo.create({
      displayName,
      profileName: displayName,
      agentType,
      isActive: true,
      connected: false,
    });
    return this.repo.save(record);
  }

  async setActive(tenantId: string, isActive: boolean): Promise<WhatsappConfig | null> {
    const record = await this.getByTenant(tenantId);
    if (!record) return null;
    record.isActive = isActive;
    return this.repo.save(record);
  }

  // Admin remove manualmente a tag "PIX em atraso" (ex: cliente pagou por fora / erro no gateway)
  async clearPastDue(tenantId: string): Promise<WhatsappConfig | null> {
    const record = await this.getByTenant(tenantId);
    if (!record) return null;
    record.planStatus = 'active';
    return this.repo.save(record);
  }

  async updateBilling(tenantId: string, fields: { nextPaymentDate?: string | null; billingPhone?: string | null; billingDay?: number | null }): Promise<WhatsappConfig | null> {
    const record = await this.getByTenant(tenantId);
    if (!record) return null;
    if ('nextPaymentDate' in fields) record.nextPaymentDate = fields.nextPaymentDate ? new Date(fields.nextPaymentDate) : null;
    if ('billingPhone' in fields) record.billingPhone = fields.billingPhone ?? null;
    if ('billingDay' in fields) record.billingDay = fields.billingDay ?? null;
    return this.repo.save(record);
  }

  async getActiveToken(): Promise<string> {
    const record = await this.get();
    return record?.instanceToken || this.config.get('UAZAPI_TOKEN') || '';
  }

  // tenantId: quando informado, cria a instância uazapi PARA aquele tenant específico
  // (salva o token na linha dele + webhook /webhooks/uazapi/{tenantId}). Sem tenantId,
  // mantém o comportamento legado (reusa a config mais recente).
  async createNewInstance(name: string, adminField01?: string, adminField02?: string, tenantId?: string): Promise<WhatsappConfig> {
    const result = await this.uazapi.createInstance(name, adminField01, adminField02);

    const instance = result?.instance ?? {};
    const instanceToken = instance.token ?? result?.token;

    if (!instanceToken) {
      throw new Error('uazapi não retornou token da nova instância');
    }

    // Tenant alvo: a linha específica do cliente (multi-tenant) ou a mais recente (legado).
    let record = tenantId ? await this.getByTenant(tenantId) : await this.get();
    if (!record) {
      record = this.repo.create();
    }
    record.instanceToken = instanceToken;
    record.profileName = instance.name ?? name;
    record.profilePicUrl = instance.profilePicUrl ?? null;
    record.connected = false;
    // Salva primeiro para obter o id (= tenantId) antes de montar a URL do webhook.
    record = await this.repo.save(record);

    // Webhook por tenant (Opção A): a URL carrega o tenantId.
    const serverUrl = this.config.get('SERVER_URL') ?? 'http://localhost:3000';
    const webhookUrl = `${serverUrl}/webhooks/uazapi/${record.id}`;

    let webhookConfigured = false;
    try {
      await this.uazapi.configureWebhook(webhookUrl, instanceToken);
      webhookConfigured = true;
      this.logger.log(`Webhook configurado para nova instância "${name}": ${webhookUrl}`);
    } catch (err) {
      this.logger.error(`Erro ao configurar webhook da nova instância "${name}": ${err.message}`);
    }

    record.webhookConfigured = webhookConfigured;
    record.webhookUrl = webhookUrl;
    return this.repo.save(record);
  }

  async setupAfterConnect(tenantId?: string): Promise<WhatsappConfig> {
    // 1. Identifica a instância: tenant específico (multi-tenant) ou mais recente (legado)
    let record = tenantId ? await this.getByTenant(tenantId) : await this.get();
    const token = record?.instanceToken;

    // 2. Busca dados atuais da instância usando o token dela
    const statusData = await this.uazapi.getInstanceStatus(token);
    const instance = statusData?.instance;

    const instanceToken = instance?.token ?? token ?? this.config.get('UAZAPI_TOKEN');
    const profileName = instance?.profileName ?? null;
    const phone = statusData?.status?.jid?.replace('@s.whatsapp.net', '').replace(/:\d+$/, '') ?? null;
    const profilePicUrl = instance?.profilePicUrl ?? null;

    // 3. Salva/atualiza config no banco — primeiro para garantir o id (= tenantId)
    if (!record) {
      record = this.repo.create();
    }
    record.instanceToken = instanceToken;
    record.profileName = profileName;
    record.phone = phone;
    record.profilePicUrl = profilePicUrl;
    record.connected = true;
    record = await this.repo.save(record);

    // 4. Webhook por tenant (Opção A): URL carrega o tenantId (= record.id)
    const serverUrl = this.config.get('SERVER_URL') ?? 'http://localhost:3000';
    const webhookUrl = `${serverUrl}/webhooks/uazapi/${record.id}`;
    const autoConfigureWebhook = this.config.get('WEBHOOK_AUTO_CONFIGURE') !== 'false';

    let webhookConfigured = record.webhookConfigured ?? false;
    // Reconfigura se ainda não configurado OU se a URL salva não tem o tenantId (legado).
    if (autoConfigureWebhook && (!webhookConfigured || record.webhookUrl !== webhookUrl)) {
      try {
        await this.uazapi.configureWebhook(webhookUrl, instanceToken);
        webhookConfigured = true;
        this.logger.log(`Webhook configurado: ${webhookUrl}`);
      } catch (err) {
        this.logger.error(`Erro ao configurar webhook: ${err.message}`);
      }
    }

    record.webhookConfigured = webhookConfigured;
    record.webhookUrl = webhookUrl;
    return this.repo.save(record);
  }

  async markDisconnected(tenantId?: string): Promise<void> {
    const record = tenantId ? await this.getByTenant(tenantId) : await this.get();
    if (record) {
      record.connected = false;
      await this.repo.save(record);
    }
  }

  async updateConfig(
    fields: {
      customPromptMegaHair?: string | null;
      autoFollowupConfig?: Record<string, { enabled?: boolean; idleMinutes?: number; message?: string }> | null;
      appointmentReminder?: { enabled?: boolean; message?: string } | null;
      multiAgentEnabled?: boolean;
      deactivationKeyword?: string | null;
      activationKeyword?: string | null;
    },
    tenantId?: string,
  ): Promise<WhatsappConfig> {
    let record = tenantId ? await this.getByTenant(tenantId) : await this.get();
    if (!record) record = this.repo.create();
    if ('customPromptMegaHair' in fields) record.customPromptMegaHair = fields.customPromptMegaHair ?? null;
    if ('autoFollowupConfig' in fields) record.autoFollowupConfig = this.sanitizeAutoFollowup(fields.autoFollowupConfig);
    if ('appointmentReminder' in fields) record.appointmentReminder = this.sanitizeAppointmentReminder(fields.appointmentReminder);
    if ('multiAgentEnabled' in fields) record.multiAgentEnabled = !!fields.multiAgentEnabled;
    if ('deactivationKeyword' in fields) record.deactivationKeyword = this.sanitizeKeyword(fields.deactivationKeyword, 'opa');
    if ('activationKeyword' in fields) record.activationKeyword = this.sanitizeKeyword(fields.activationKeyword, 'volta');
    return this.repo.save(record);
  }

  private sanitizeKeyword(raw: string | null | undefined, fallback: string): string {
    const trimmed = String(raw ?? '').trim().slice(0, 40);
    return trimmed || fallback;
  }

  private sanitizeAppointmentReminder(raw: { enabled?: boolean; message?: string } | null | undefined): WhatsappConfig['appointmentReminder'] {
    if (!raw || typeof raw !== 'object') return null;
    return { enabled: !!raw.enabled, message: String(raw.message ?? '').slice(0, 1000) };
  }

  // Aceita apenas as 3 raias conhecidas; força tipos e limites seguros.
  private sanitizeAutoFollowup(
    raw: Record<string, { enabled?: boolean; idleMinutes?: number; message?: string }> | null | undefined,
  ): WhatsappConfig['autoFollowupConfig'] {
    if (!raw || typeof raw !== 'object') return null;
    const STAGES = ['novo_lead', 'lead_frio', 'lead_quente'];
    const clean: Record<string, { enabled: boolean; idleMinutes: number; message: string }> = {};
    for (const stage of STAGES) {
      const cfg = raw[stage];
      if (!cfg || typeof cfg !== 'object') continue;
      const idleMinutes = Math.max(1, Math.floor(Number(cfg.idleMinutes) || 0));
      const message = String(cfg.message ?? '').slice(0, 1000);
      clean[stage] = { enabled: !!cfg.enabled, idleMinutes, message };
    }
    return Object.keys(clean).length > 0 ? clean : null;
  }

  async deleteRecord(tenantId?: string): Promise<void> {
    // Limpa apenas os campos da instância WhatsApp, MANTÉM customPromptSofia,
    // customPromptMegaHair e agentType para que sobrevivam a "Remover conexão".
    const record = tenantId ? await this.getByTenant(tenantId) : await this.get();
    if (record) {
      record.instanceToken = null as any;
      record.profileName = null as any;
      record.phone = null as any;
      record.profilePicUrl = null as any;
      record.connected = false;
      record.webhookConfigured = false;
      record.webhookUrl = null as any;
      await this.repo.save(record);
    }
  }

  async deleteTenant(tenantId: string): Promise<void> {
    await this.repo.delete({ id: tenantId });
  }
}
