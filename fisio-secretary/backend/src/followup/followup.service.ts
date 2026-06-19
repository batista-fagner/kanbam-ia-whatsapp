import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import Redis from 'ioredis';
import { Followup } from '../common/entities/followup.entity';
import { WhatsappConfig } from '../common/entities/whatsapp-config.entity';
import { LeadsService } from '../leads/leads.service';
import { LeadsGateway } from '../leads/leads.gateway';
import { AiService } from '../ai/ai.service';

// Delays permitidos (horas). O front oferece 1h / 4h / 24h.
const ALLOWED_DELAYS = [1, 4, 24];

@Injectable()
export class FollowupService {
  private readonly logger = new Logger(FollowupService.name);
  private redis: Redis;

  constructor(
    @InjectRepository(Followup)
    private readonly followupRepo: Repository<Followup>,
    @InjectRepository(WhatsappConfig)
    private readonly configRepo: Repository<WhatsappConfig>,
    private readonly leadsService: LeadsService,
    private readonly leadsGateway: LeadsGateway,
    private readonly aiService: AiService,
    private readonly config: ConfigService,
    private readonly http: HttpService,
  ) {
    const redisUrl = this.config.get<string>('REDIS_URL');
    if (redisUrl) {
      this.redis = new Redis(redisUrl);
    }
  }

  // ───────────────────────── API ─────────────────────────

  // Gera uma sugestão de mensagem com a IA (modelo lite) a partir da conversa do lead.
  async generateSuggestion(leadId: string, tenantId: string): Promise<{ text: string }> {
    const lead = await this.leadsService.findOne(leadId, tenantId);
    if (!lead) throw new NotFoundException('Lead não encontrado');

    const conversation = await this.leadsService.getConversationWithMessages(leadId, tenantId);
    const transcript = this.buildTranscript(conversation?.messages ?? []);
    const text = await this.aiService.generateFollowupSuggestion(lead.name, transcript);
    return { text };
  }

  // Agenda um follow-up. delayHours: 1 | 4 | 24 (a partir de agora).
  async schedule(leadId: string, tenantId: string, message: string, delayHours: number): Promise<Followup> {
    const text = (message ?? '').trim();
    if (!text) throw new BadRequestException('Mensagem é obrigatória');
    if (!ALLOWED_DELAYS.includes(delayHours)) {
      throw new BadRequestException('Tempo inválido (use 1, 4 ou 24 horas)');
    }
    const lead = await this.leadsService.findOne(leadId, tenantId);
    if (!lead) throw new NotFoundException('Lead não encontrado');

    const scheduledAt = new Date(Date.now() + delayHours * 3600_000);
    const followup = this.followupRepo.create({
      tenantId,
      leadId,
      phone: lead.phone,
      message: text,
      scheduledAt,
      status: 'pending',
    });
    const saved = await this.followupRepo.save(followup);
    this.logger.log(`[FOLLOWUP] Agendado p/ ${lead.phone} em ${delayHours}h (${scheduledAt.toISOString()})`);
    return saved;
  }

  // Lista os follow-ups pendentes de um lead (mostrados no modal).
  async listForLead(leadId: string, tenantId: string): Promise<Followup[]> {
    return this.followupRepo.find({
      where: { leadId, tenantId, status: 'pending' },
      order: { scheduledAt: 'ASC' },
    });
  }

  // Cancela um follow-up pendente.
  async cancel(id: string, tenantId: string): Promise<{ ok: boolean }> {
    const followup = await this.followupRepo.findOne({ where: { id, tenantId } });
    if (!followup) throw new NotFoundException('Follow-up não encontrado');
    if (followup.status === 'pending') {
      followup.status = 'canceled';
      await this.followupRepo.save(followup);
    }
    return { ok: true };
  }

  // ───────────────────────── Cron ─────────────────────────

  // A cada minuto: envia os follow-ups vencidos (scheduledAt <= agora).
  // Lock distribuído (Redis) evita processamento duplicado em múltiplas instâncias.
  @Cron(CronExpression.EVERY_MINUTE)
  async processDue(): Promise<void> {
    const lockKey = 'followup:cron:lock';
    const lockTtl = 50; // 50 segundos (cron roda a cada 60s)

    if (!this.redis) {
      this.logger.warn('[FOLLOWUP] Redis não configurado, processando sem lock (risco de duplicação)');
      return this.processFollowups();
    }

    try {
      const acquired = await this.redis.set(lockKey, '1', 'EX', lockTtl, 'NX');
      if (!acquired) {
        this.logger.debug('[FOLLOWUP] Outra instância já está processando');
        return;
      }
      await this.processFollowups();
    } catch (err) {
      this.logger.error(`[FOLLOWUP] Erro ao adquirir lock: ${err.message}`);
    }
  }

  private async processFollowups(): Promise<void> {
    const due = await this.followupRepo.find({
      where: { status: 'pending', scheduledAt: LessThanOrEqual(new Date()) },
      order: { scheduledAt: 'ASC' },
      take: 50,
    });
    if (due.length === 0) return;

    this.logger.log(`[FOLLOWUP] ${due.length} follow-up(s) a enviar`);
    for (const f of due) {
      try {
        await this.send(f);
        f.status = 'sent';
        f.sentAt = new Date();
        f.error = null;
        await this.followupRepo.save(f);
        this.logger.log(`[FOLLOWUP] Enviado → ${f.phone} (lead ${f.leadId})`);
      } catch (err) {
        f.status = 'failed';
        f.error = err?.message ?? 'erro desconhecido';
        await this.followupRepo.save(f);
        this.logger.error(`[FOLLOWUP] Falha ao enviar p/ ${f.phone}: ${f.error}`);
      }
    }
  }

  // ───────────────────────── Helpers ─────────────────────────

  private async send(f: Followup): Promise<void> {
    const baseUrl = this.config.get<string>('UAZAPI_BASE_URL') ?? '';
    const token = await this.resolveTenantToken(f.tenantId);
    if (!token) throw new Error('Token da instância não encontrado');

    await firstValueFrom(
      this.http.post(`${baseUrl}/send/text`, { number: f.phone, text: f.message }, { headers: { token } }),
    );

    // Registra na conversa + atualiza o lead no kanban em tempo real.
    const conversation = await this.leadsService.getConversationWithMessages(f.leadId, f.tenantId);
    if (conversation?.id) {
      await this.leadsService.saveMessage(conversation.id, 'outbound', 'operator', f.message);
    }
    await this.leadsService.update(f.leadId, { lastMessageAt: new Date() } as any, f.tenantId);
    const lead = await this.leadsService.findOne(f.leadId, f.tenantId);
    if (lead) this.leadsGateway.emitLeadUpdated(lead);
  }

  private async resolveTenantToken(tenantId: string): Promise<string> {
    const sc = await this.configRepo.findOne({ where: { id: tenantId } });
    if (sc?.instanceToken) return sc.instanceToken;
    return this.config.get<string>('UAZAPI_TOKEN') ?? '';
  }

  private buildTranscript(messages: Array<{ direction: string; sender: string; content: string }>): string {
    // Limita às últimas 30 mensagens p/ controlar tokens.
    const recent = messages.slice(-30);
    return recent
      .map((m) => {
        const who = m.direction === 'inbound' ? 'Cliente' : (m.sender === 'ai' ? 'Lindona' : 'Operador');
        return `${who}: ${m.content}`;
      })
      .join('\n');
  }
}
