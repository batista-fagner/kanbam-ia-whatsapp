import { Logger } from '@nestjs/common';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { FollowupService } from './followup.service';
import { FOLLOWUP_TRIGGER_QUEUE_NAME, JOB_APPOINTMENT_REMINDER, JOB_CADENCE_STEP, JOB_IDLE_CHECK, JOB_POST_SALE } from '../queue/queue.constants';

// Executa os gatilhos agendados pela FollowupTriggerQueueService. Toda a decisão (o lead
// ainda está parado? a âncora bate? horário comercial?) fica no FollowupService, que relê
// o banco na hora — o job só carrega ids, nunca estado que possa ter ficado velho.
@Processor(FOLLOWUP_TRIGGER_QUEUE_NAME, { concurrency: 5 })
export class FollowupTriggerProcessor extends WorkerHost {
  private readonly logger = new Logger(FollowupTriggerProcessor.name);

  constructor(private readonly followups: FollowupService) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case JOB_IDLE_CHECK:
        return this.followups.runIdleCheck(job.data);
      case JOB_CADENCE_STEP:
        return this.followups.runCadenceStep(job.data);
      case JOB_APPOINTMENT_REMINDER:
        return this.followups.runAppointmentReminder(job.data);
      case JOB_POST_SALE:
        return this.followups.runPostSale(job.data);
      default:
        this.logger.warn(`[FU-TRIGGER] Job desconhecido: ${job.name}`);
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job): void {
    if (!job) return;
    if ((job.attemptsMade ?? 0) < (job.opts?.attempts ?? 1)) return;
    this.logger.error(`[FU-TRIGGER] ${job.name} ${job.id} falhou definitivamente: ${job.failedReason}`);
  }
}
