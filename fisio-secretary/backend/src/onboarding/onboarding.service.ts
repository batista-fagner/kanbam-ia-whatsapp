import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { Resend } from 'resend';
import { WhatsappConfig } from '../common/entities/whatsapp-config.entity';
import { OnboardingSettings } from '../common/entities/onboarding-settings.entity';
import { OnboardingQueueService } from './onboarding-queue.service';

// Onboarding automático: assim que um pagamento é confirmado (PIX ou cartão), cria o grupo
// "Projeto <cliente>" no WhatsApp com a cliente + a equipe, manda a mensagem de boas-vindas
// e agenda a 2ª mensagem (link do formulário) pra X minutos depois.
//
// Nada aqui pode derrubar a criação da conta: os gatilhos em payments.service.ts chamam
// dentro de try/catch e todo erro daqui vira log + alerta pro admin, nunca exceção pra cima.
@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);
  private readonly resend: Resend | null;

  constructor(
    @InjectRepository(WhatsappConfig) private readonly configRepo: Repository<WhatsappConfig>,
    @InjectRepository(OnboardingSettings) private readonly settingsRepo: Repository<OnboardingSettings>,
    private readonly config: ConfigService,
    private readonly http: HttpService,
    private readonly queue: OnboardingQueueService,
  ) {
    const resendKey = this.config.get<string>('RESEND_API_KEY');
    this.resend = resendKey ? new Resend(resendKey) : null;
  }

  // ───────────────────────── Configuração (linha única) ─────────────────────────

  async getSettings(): Promise<OnboardingSettings> {
    let settings = await this.settingsRepo.findOne({ where: { id: 1 } });
    if (!settings) {
      settings = await this.settingsRepo.save(this.settingsRepo.create({ id: 1, teamPhones: [] }));
    }
    return settings;
  }

  async updateSettings(body: {
    groupEnabled?: boolean;
    teamPhones?: string[];
    welcomeMessage?: string;
    formMessageEnabled?: boolean;
    formMessage?: string;
    formDelayMinutes?: number;
    formUrl?: string;
    formEntryField?: string;
  }): Promise<OnboardingSettings> {
    const settings = await this.getSettings();
    if (body.groupEnabled !== undefined) settings.groupEnabled = body.groupEnabled;
    if (body.teamPhones !== undefined) {
      settings.teamPhones = body.teamPhones
        .map((p) => String(p).replace(/\D/g, ''))
        .filter((p) => p.length >= 10);
    }
    if (body.welcomeMessage !== undefined) settings.welcomeMessage = body.welcomeMessage;
    if (body.formMessageEnabled !== undefined) settings.formMessageEnabled = body.formMessageEnabled;
    if (body.formMessage !== undefined) settings.formMessage = body.formMessage;
    if (body.formDelayMinutes !== undefined) {
      const minutes = Number(body.formDelayMinutes);
      settings.formDelayMinutes = Number.isFinite(minutes) && minutes >= 0 ? Math.round(minutes) : 60;
    }
    if (body.formUrl !== undefined) settings.formUrl = body.formUrl.trim();
    if (body.formEntryField !== undefined) settings.formEntryField = body.formEntryField.trim();
    return this.settingsRepo.save(settings);
  }

  // ───────────────────────── Fluxo principal ─────────────────────────

  // Chamado pelos dois gatilhos de pagamento confirmado (cartão e 1ª cobrança PIX).
  async createProjectGroup(tenantId: string, clientName: string, clientPhone: string | null): Promise<void> {
    const settings = await this.getSettings();
    if (!settings.groupEnabled) {
      this.logger.log(`[ONBOARDING] Criação de grupo desligada nas configurações — tenant ${tenantId} ignorado`);
      return;
    }

    const tenant = await this.configRepo.findOne({ where: { id: tenantId } });
    if (!tenant) {
      this.logger.error(`[ONBOARDING] Tenant ${tenantId} não encontrado — grupo não criado`);
      return;
    }
    // Trava de idempotência: webhook duplicado do Stripe (checkout.session.completed +
    // customer.subscription.created) não pode gerar dois grupos.
    if (tenant.onboardingGroupJid) {
      this.logger.log(`[ONBOARDING] Tenant ${tenantId} já tem grupo (${tenant.onboardingGroupJid}) — ignorando`);
      return;
    }

    const name = (clientName || tenant.displayName || 'Cliente').trim();
    const phone = clientPhone || tenant.billingPhone || null;
    const participants = this._buildParticipants(phone, settings.teamPhones);
    if (participants.length === 0) {
      this.logger.error(`[ONBOARDING] Sem participantes válidos pro grupo do tenant ${tenantId}`);
      await this._alertAdmin(`Não consegui criar o grupo de *${name}*: nenhum número válido (cliente sem telefone e equipe vazia nas configurações).`);
      return;
    }

    const groupName = `Projeto ${name}`;
    let created: any;
    try {
      created = await this._createGroup(groupName, participants);
    } catch (err) {
      const detail = err?.response?.data ? JSON.stringify(err.response.data).slice(0, 300) : err.message;
      this.logger.error(`[ONBOARDING] Falha ao criar grupo "${groupName}" (tenant ${tenantId}): ${detail}`);
      await this._alertAdmin(`🔴 Falha ao criar o grupo *${groupName}* automaticamente.\n\nErro: ${detail}\n\nCria na mão e segue o onboarding normal.`);
      return;
    }

    const jid = created.JID;
    if (!jid) {
      this.logger.error(`[ONBOARDING] uazapi não devolveu JID pro grupo "${groupName}" (tenant ${tenantId})`);
      await this._alertAdmin(`🔴 Grupo *${groupName}* pode ter sido criado, mas a API não devolveu o identificador — confere no WhatsApp.`);
      return;
    }

    tenant.onboardingGroupJid = jid;
    await this.configRepo.save(tenant);
    this.logger.log(`[ONBOARDING] Grupo "${groupName}" criado (${jid}) — tenant ${tenantId}`);

    // A cliente pode ter privacidade que bloqueia ser adicionada em grupo — nesse caso a
    // uazapi cria o grupo sem ela e devolve um link de convite. Manda o link no privado dela.
    await this._handleClientNotAdded(created, phone, name, groupName);

    if (settings.welcomeMessage?.trim()) {
      const sent = await this._sendText(jid, this._applyVars(settings.welcomeMessage, { nome: name }));
      if (!sent) {
        await this._alertAdmin(`⚠️ Grupo *${groupName}* criado, mas a mensagem de boas-vindas não foi entregue. Manda na mão.`);
      }
    }

    if (settings.formMessageEnabled && settings.formMessage?.trim()) {
      await this.queue.scheduleFormMessage(tenantId, settings.formDelayMinutes);
    }
  }

  // Chamado pelo job atrasado (onboarding-form.processor.ts).
  async sendFormMessage(tenantId: string): Promise<void> {
    const settings = await this.getSettings();
    if (!settings.formMessageEnabled || !settings.formMessage?.trim()) return;

    const tenant = await this.configRepo.findOne({ where: { id: tenantId } });
    if (!tenant?.onboardingGroupJid) {
      this.logger.warn(`[ONBOARDING] Tenant ${tenantId} sem grupo — 2ª mensagem não enviada`);
      return;
    }

    const link = this.buildFormLink(settings, tenantId);
    const text = this._applyVars(settings.formMessage, { nome: tenant.displayName ?? 'Cliente', link });
    const sent = await this._sendText(tenant.onboardingGroupJid, text);
    if (sent) {
      this.logger.log(`[ONBOARDING] Link do formulário enviado no grupo do tenant ${tenantId}`);
    } else {
      await this._alertAdmin(`⚠️ Não consegui enviar o link do formulário no grupo de *${tenant.displayName ?? tenantId}*. Manda na mão.`);
    }
  }

  // Mesmo link que o Admin já copia na mão (AdminPage.jsx buildOnboardingLink).
  buildFormLink(settings: OnboardingSettings, tenantId: string): string {
    if (!settings.formUrl) return '';
    if (!settings.formEntryField) return settings.formUrl;
    return `${settings.formUrl}?usp=pp_url&${settings.formEntryField}=${tenantId}`;
  }

  // Cria um grupo só com a equipe, pra validar credencial/instância sem tocar em cliente real.
  async createTestGroup(): Promise<{ jid: string | null; name: string; participants: string[] }> {
    const settings = await this.getSettings();
    const participants = this._buildParticipants(null, settings.teamPhones);
    const name = `Projeto TESTE ${new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
    const created = await this._createGroup(name, participants);
    if (created.JID && settings.welcomeMessage?.trim()) {
      await this._sendText(created.JID, this._applyVars(settings.welcomeMessage, { nome: 'Teste' }));
    }
    this.logger.log(`[ONBOARDING] Grupo de teste "${name}" criado (${created.JID})`);
    return { jid: created.JID, name, participants };
  }

  // ───────────────────────── uazapi ─────────────────────────

  // A uazapi responde { failed: [...], group: { JID, Participants, ... } } — não achata os
  // campos do grupo na raiz como a documentação da rota sugere. Normaliza aqui, uma vez só,
  // pra quem chama não precisar saber desse detalhe.
  private async _createGroup(name: string, participants: string[]): Promise<{ JID: string | null; Participants: any[]; invite_link: string | null; failed: string[] }> {
    const baseUrl = this.config.get<string>('UAZAPI_BASE_URL') ?? '';
    const token = await this._resolveSenderToken();
    const res = await firstValueFrom(
      this.http.post(`${baseUrl}/group/create`, { name, participants }, { headers: { token } }),
    );
    const data = res.data ?? {};
    const group = data.group ?? data; // fallback pro formato "achatado" caso a API mude de novo
    return {
      JID: group.JID ?? group.jid ?? null,
      Participants: Array.isArray(group.Participants) ? group.Participants : [],
      invite_link: group.invite_link ?? data.invite_link ?? null,
      failed: Array.isArray(data.failed) ? data.failed : [],
    };
  }

  // Mesma resolução usada pelos envios da empresa (payments.service.ts _resolveSenderToken):
  // o grupo precisa nascer de uma sessão WhatsApp ativa, e essa é a instância que já manda
  // credenciais e alertas — não a instância do cliente.
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
    } catch (err) {
      this.logger.error(`[ONBOARDING] Falha ao enviar texto para ${numberOrJid} [HTTP ${err?.response?.status ?? 'N/A'}]: ${err.message}`);
      return false;
    }
  }

  // ───────────────────────── Helpers ─────────────────────────

  // Cliente primeiro, depois a equipe; sem duplicados e sem número inválido.
  private _buildParticipants(clientPhone: string | null, teamPhones: string[]): string[] {
    const all = [clientPhone, ...(teamPhones ?? [])]
      .filter((p): p is string => !!p)
      .map((p) => this._normalizePhone(p))
      .filter((p) => p.length >= 12); // 55 + DDD + número
    return [...new Set(all)];
  }

  // Mesma regra de payments.service.ts _normalizePhoneMeta — a uazapi quer só dígitos com DDI.
  private _normalizePhone(phone: string): string {
    const digits = String(phone).replace(/\D/g, '');
    if (digits.startsWith('55')) return digits;
    if (digits.length === 10 || digits.length === 11) return `55${digits}`;
    return digits;
  }

  private _applyVars(template: string, vars: { nome?: string; link?: string }): string {
    return template
      .replace(/\{nome\}/gi, vars.nome ?? '')
      .replace(/\{link\}/gi, vars.link ?? '');
  }

  // A uazapi devolve os números que falharam em "failed" e a lista completa em "Participants"
  // (cada um com Error=0 se deu certo). Se a cliente não entrou (privacidade de grupo), manda
  // o link de convite no privado dela.
  private async _handleClientNotAdded(
    created: { Participants: any[]; invite_link: string | null; failed: string[] },
    clientPhone: string | null,
    name: string,
    groupName: string,
  ): Promise<void> {
    if (!clientPhone) return;
    const clientDigits = this._normalizePhone(clientPhone);
    const failedDigits = created.failed.map((p) => String(p).replace(/\D/g, ''));
    const inFailedList = failedDigits.some((d) => d.includes(clientDigits) || clientDigits.includes(d));

    const entry = created.Participants.find((p) => String(p?.JID ?? p?.PhoneNumber ?? '').replace(/\D/g, '').includes(clientDigits));
    // Entrada com Error=0 → confirmado que entrou. Sem entrada nenhuma e sem constar em
    // "failed" também é tratado como sucesso (algumas respostas da uazapi vêm sem a lista
    // completa de participantes). Só trata como falha quando há sinal explícito de erro.
    const added = !inFailedList && (!entry || Number(entry.Error) === 0);
    if (added) return;

    const inviteLink = created.invite_link;
    this.logger.warn(`[ONBOARDING] Cliente ${clientDigits} não entrou automaticamente no grupo "${groupName}"`);
    if (inviteLink) {
      await this._sendText(clientDigits, `Oi ${name}! Esse é o grupo do seu projeto com a nossa equipe — entra por aqui: ${inviteLink}`);
      await this._alertAdmin(`⚠️ *${name}* não pôde ser adicionada direto no grupo *${groupName}* (privacidade). Mandei o link de convite no privado dela.`);
    } else {
      await this._alertAdmin(`⚠️ *${name}* não entrou no grupo *${groupName}* e a API não devolveu link de convite. Adiciona na mão.`);
    }
  }

  // Mesmo padrão do alerta de pagamento falho (payments.service.ts _onPaymentIntentFailed):
  // WhatsApp e e-mail são independentes — o e-mail fica de registro mesmo se o número estiver
  // restrito.
  private async _alertAdmin(text: string): Promise<void> {
    const adminPhone = this.config.get<string>('ADMIN_ALERT_PHONE');
    const adminEmail = this.config.get<string>('ADMIN_ALERT_EMAIL');

    if (adminPhone) await this._sendText(adminPhone, `[Onboarding]\n\n${text}`);

    if (adminEmail && this.resend) {
      const from = this.config.get<string>('RESEND_FROM_EMAIL') ?? 'Convert Hair <onboarding@resend.dev>';
      try {
        await this.resend.emails.send({
          from,
          to: adminEmail,
          subject: '⚠️ Onboarding automático — atenção necessária',
          html: `<div style="font-family: sans-serif; font-size: 14px; line-height: 1.6; color: #1f1f1f;">${text.replace(/\*/g, '').replace(/\n/g, '<br>')}</div>`,
        });
      } catch (err) {
        this.logger.error(`[ONBOARDING] Falha ao enviar alerta por e-mail: ${err.message}`);
      }
    }
  }
}
