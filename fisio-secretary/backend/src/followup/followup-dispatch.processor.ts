import { Logger } from '@nestjs/common';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';
import { Followup } from '../common/entities/followup.entity';
import { FollowupService } from './followup.service';
import { FollowupQueueService } from './followup-queue.service';
import { FOLLOWUP_QUEUE_NAME } from '../queue/queue.constants';

// Mesmas proteções anti-bloqueio do processDue(), só que aplicadas a um follow-up por vez.
// Quando uma delas barra o envio, o job é reagendado para o instante em que ela deixa de
// barrar (abertura da janela, virada do dia) — sem reperguntar de tempos em tempos.
// Jitter: vários follow-ups barrados não voltam todos no mesmo milissegundo.
const REOPEN_JITTER_MS = 60_000;
const MIN_TENANT_SEND_GAP_MS = 3 * 60 * 1000; // igual ao followup.service.ts

@Processor(FOLLOWUP_QUEUE_NAME, { concurrency: 5 })
export class FollowupDispatchProcessor extends WorkerHost {
  private readonly logger = new Logger(FollowupDispatchProcessor.name);

  constructor(
    @InjectRepository(Followup) private readonly followupRepo: Repository<Followup>,
    private readonly followups: FollowupService,
    private readonly followupQueue: FollowupQueueService,
  ) {
    super();
  }

  async process(job: Job<{ followupId: string }>): Promise<void> {
    const f = await this.followupRepo.findOne({ where: { id: job.data.followupId } });
    if (!f || f.status !== 'pending') return; // cancelado no painel ou já enviado

    // PROTEÇÃO 1 — janela de horário do tenant: volta na abertura.
    if (!this.followups.isWithinBusinessHours(f.tenantId)) {
      await this.rescheduleAt(f.id, this.followups.nextBusinessWindowStart(f.tenantId));
      return;
    }

    // PROTEÇÃO 2 — teto diário por tenant.
    const [sentToday, limit] = await Promise.all([
      this.followups.countSentTodayByTenant(f.tenantId),
      this.followups.followupDailyLimit(f.tenantId),
    ]);
    if (sentToday >= limit) {
      // Teto do dia (escolhido pela cliente em Regras de Alertas): volta na abertura de amanhã.
      this.logger.warn(`[FOLLOWUP][queue] Teto diário (${limit}) atingido p/ tenant ${f.tenantId} — adiando pra amanhã`);
      await this.rescheduleAt(f.id, this.followups.nextBusinessWindowStart(f.tenantId, this.followups.startOfNextDayBRT()));
      return;
    }

    // PROTEÇÃO 3 — espaçamento mínimo entre envios do mesmo tenant. Aqui dá pra calcular
    // o instante exato em que a janela abre, então o job volta na hora certa.
    const lastSent = await this.followups.lastSentAtByTenant(f.tenantId);
    if (lastSent && Date.now() - lastSent.getTime() < MIN_TENANT_SEND_GAP_MS) {
      const waitMs = MIN_TENANT_SEND_GAP_MS - (Date.now() - lastSent.getTime());
      await this.reschedule(f.id, waitMs);
      return;
    }

    // PROTEÇÃO 4 — vaga atômica por tenant: a PROTEÇÃO 3 sozinha não segura jobs
    // concorrentes do mesmo tenant (lêem o mesmo "último envio" no mesmo instante).
    const slotWaitMs = await this.followupQueue.tryAcquireSendSlot(f.tenantId, MIN_TENANT_SEND_GAP_MS);
    if (slotWaitMs > 0) {
      await this.reschedule(f.id, slotWaitMs + Math.floor(Math.random() * 5000));
      return;
    }

    // Claim atômico + envio. Se lançar, o BullMQ aplica attempts/backoff.
    await this.followups.claimAndSend(f);
  }

  private async reschedule(followupId: string, delayMs: number): Promise<void> {
    await this.followupQueue.requeue(followupId, delayMs);
  }

  private async rescheduleAt(followupId: string, at: Date): Promise<void> {
    const delay = Math.max(1_000, at.getTime() - Date.now()) + Math.floor(Math.random() * REOPEN_JITTER_MS);
    await this.reschedule(followupId, delay);
  }

  // Só dispara depois de esgotadas as tentativas (attempts) — aí sim é falha definitiva.
  @OnWorkerEvent('failed')
  async onFailed(job: Job<{ followupId: string }>): Promise<void> {
    if (!job?.data?.followupId) return;
    if ((job.attemptsMade ?? 0) < (job.opts?.attempts ?? 1)) return; // ainda há retry pela frente
    await this.followupRepo.update(job.data.followupId, { status: 'failed' as any });
    this.logger.error(`[FOLLOWUP][queue] Follow-up ${job.data.followupId} falhou definitivamente`);
  }
}
