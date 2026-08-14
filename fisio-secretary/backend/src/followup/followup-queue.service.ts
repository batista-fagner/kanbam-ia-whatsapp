import { Injectable, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { FOLLOWUP_QUEUE_NAME, JOB_DISPATCH_FOLLOWUP, QUEUE_ENGINE_BULLMQ } from '../queue/queue.constants';

// Um job por follow-up, agendado para o próprio scheduledAt — no lugar do cron que varre
// a tabela inteira a cada minuto procurando vencidos.
@Injectable()
export class FollowupQueueService {
  constructor(
    // @Optional: no modo legado a fila nem é registrada (ver queue.module.ts).
    @Optional() @InjectQueue(FOLLOWUP_QUEUE_NAME) private readonly queue: Queue | null,
    private readonly config: ConfigService,
  ) {}

  private get enabled(): boolean {
    return !!this.queue && this.config.get<string>('QUEUE_ENGINE') === QUEUE_ENGINE_BULLMQ;
  }

  // extraJitterMs espalha follow-ups criados no mesmo instante (o cron de cadência cria
  // vários de uma vez). O espaçamento real entre envios do mesmo tenant continua sendo
  // garantido no processor, com os mesmos 3min do fluxo legado.
  // Separador '_' e não ':': o BullMQ rejeita jobId com ':' (reservado às chaves internas).
  private jobId(followupId: string, suffix?: string): string {
    return suffix ? `followup_${followupId}_${suffix}` : `followup_${followupId}`;
  }

  async enqueue(followupId: string, scheduledAt: Date, extraJitterMs = 0): Promise<void> {
    if (!this.enabled) return;
    const delay = Math.max(0, new Date(scheduledAt).getTime() - Date.now()) + extraJitterMs;
    await this.add(followupId, delay, this.jobId(followupId));
  }

  // Reagendamento a partir de DENTRO do processamento (bloqueado por janela/teto/espaçamento).
  // Precisa de jobId diferente: o job em execução ainda ocupa o id base no Redis, e um add
  // com jobId existente é descartado em silêncio — o follow-up sumiria da fila pra sempre.
  async requeue(followupId: string, delayMs: number): Promise<void> {
    if (!this.enabled) return;
    await this.add(followupId, delayMs, this.jobId(followupId, `r${Date.now()}`));
  }

  private async add(followupId: string, delay: number, jobId: string): Promise<void> {
    const queue = this.queue;
    if (!queue) return;
    await queue.add(
      JOB_DISPATCH_FOLLOWUP,
      { followupId },
      {
        jobId,
        delay,
        // Aqui o retry do BullMQ faz sentido: falha é HTTP (uazapi fora do ar), não
        // máquina de estados. Hoje um follow-up que falha fica parado até intervenção manual.
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: true,
        removeOnFail: { count: 200 },
      },
    );
  }

  // Sem guard de propósito: remover um jobId inexistente é no-op, então funciona igual
  // nos dois modos e não deixa job órfão se o engine for trocado com follow-ups na fila.
  async cancel(followupId: string): Promise<void> {
    if (!this.queue) return;
    await this.queue.remove(this.jobId(followupId)).catch(() => undefined);
  }
}
