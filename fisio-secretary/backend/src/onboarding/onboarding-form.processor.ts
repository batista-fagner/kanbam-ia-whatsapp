import { Logger } from '@nestjs/common';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ONBOARDING_QUEUE_NAME } from '../queue/queue.constants';
import { OnboardingService } from './onboarding.service';

// Envia a 2ª mensagem do onboarding (link do formulário) no grupo do cliente, no horário
// agendado por OnboardingQueueService.
@Processor(ONBOARDING_QUEUE_NAME, { concurrency: 3 })
export class OnboardingFormProcessor extends WorkerHost {
  private readonly logger = new Logger(OnboardingFormProcessor.name);

  constructor(private readonly onboarding: OnboardingService) {
    super();
  }

  async process(job: Job<{ tenantId: string }>): Promise<void> {
    await this.onboarding.sendFormMessage(job.data.tenantId);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<{ tenantId: string }>, err: Error) {
    this.logger.error(`[ONBOARDING][queue] Job ${job?.id} falhou (tenant ${job?.data?.tenantId}): ${err.message}`);
  }
}
