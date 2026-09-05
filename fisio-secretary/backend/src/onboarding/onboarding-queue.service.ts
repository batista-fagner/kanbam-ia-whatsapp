import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { ONBOARDING_QUEUE_NAME, JOB_SEND_FORM_MESSAGE, QUEUE_ENGINE_BULLMQ } from '../queue/queue.constants';

// A 2ª mensagem do onboarding (link do formulário) é um job único com delay — nada de cron
// varrendo tabela: ele fica parado no Redis até a hora certa.
@Injectable()
export class OnboardingQueueService {
  private readonly logger = new Logger(OnboardingQueueService.name);

  constructor(
    // @Optional: no modo legado a fila nem é registrada (ver onboarding.module.ts), então a
    // injeção vem nula e os métodos viram no-op.
    @Optional() @InjectQueue(ONBOARDING_QUEUE_NAME) private readonly queue: Queue | null,
    private readonly config: ConfigService,
  ) {}

  private get activeQueue(): Queue | null {
    if (this.config.get<string>('QUEUE_ENGINE') !== QUEUE_ENGINE_BULLMQ) return null;
    return this.queue ?? null;
  }

  // jobId com '_' e não ':' — o BullMQ rejeita ':' (reservado nas chaves do Redis).
  private jobId(tenantId: string): string {
    return `onboarding-form_${tenantId}`;
  }

  async scheduleFormMessage(tenantId: string, delayMinutes: number): Promise<void> {
    const queue = this.activeQueue;
    if (!queue) {
      this.logger.warn(
        `[ONBOARDING][queue] QUEUE_ENGINE != bullmq — 2ª mensagem do tenant ${tenantId} NÃO foi agendada (mandar o formulário na mão)`,
      );
      return;
    }
    const delay = Math.max(0, Math.round(delayMinutes) * 60_000);
    await queue.add(
      JOB_SEND_FORM_MESSAGE,
      { tenantId },
      {
        jobId: this.jobId(tenantId),
        delay,
        // Falha aqui é HTTP (uazapi fora do ar), não máquina de estados — retry faz sentido.
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: true,
        removeOnFail: { count: 100 },
      },
    );
    this.logger.log(`[ONBOARDING][queue] 2ª mensagem do tenant ${tenantId} agendada para daqui a ${delayMinutes}min`);
  }
}
