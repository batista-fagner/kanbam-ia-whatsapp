import { Injectable, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import {
  FOLLOWUP_TRIGGER_QUEUE_NAME, JOB_APPOINTMENT_REMINDER, JOB_CADENCE_STEP, JOB_IDLE_CHECK, JOB_POST_SALE, QUEUE_ENGINE_BULLMQ,
} from '../queue/queue.constants';

// Lead parado na raia: ancorado na ÚLTIMA mensagem (nossa) da conversa. Se chegar
// mensagem nova depois, o job antigo vira no-op — o da mensagem nova já foi agendado.
export interface IdleCheckJob { tenantId: string; leadId: string; stage: string; messageId: string }
// Toque de cadência: ancorado no next_nurture_at (ms). Resposta do lead muda a âncora.
export interface CadenceStepJob { tenantId: string; leadId: string; anchor: number }
// Lembrete: ancorado no horário do agendamento (ms). Remarcar muda a âncora.
export interface AppointmentReminderJob { appointmentId: string; startMs: number }
// Pós-venda: ancorado na entrada em Vendas (linha do lead_stage_history). Sair e voltar
// pra Vendas cria outra entrada — o job da venda anterior vira no-op.
export interface PostSaleJob { tenantId: string; leadId: string; entryId: string }

// Piso de delay: quem emite o gatilho pode estar logo antes do commit, e um job com
// delay 0 poderia ler o banco antes da linha existir.
const MIN_DELAY_MS = 5_000;

@Injectable()
export class FollowupTriggerQueueService {
  constructor(
    // @Optional: no modo legado a fila nem é registrada (ver followup.module.ts).
    @Optional() @InjectQueue(FOLLOWUP_TRIGGER_QUEUE_NAME) private readonly queue: Queue | null,
    private readonly config: ConfigService,
  ) {}

  private get enabled(): boolean {
    return !!this.queue && this.config.get<string>('QUEUE_ENGINE') === QUEUE_ENGINE_BULLMQ;
  }

  // jobId determinístico: o mesmo gatilho emitido de novo (subida, config salva, outra
  // mensagem com a mesma âncora) não duplica — o BullMQ descarta add com id existente.
  // `retryTag` existe para o reagendamento de DENTRO do job (fora do horário, tempo
  // aumentado): o job em execução ainda ocupa o id base e o add seria descartado.
  // Separador '_' e não ':' (o BullMQ rejeita ':' no jobId).
  idleCheckJobId(d: IdleCheckJob, retryTag?: string): string {
    return this.withTag(`idle_${d.leadId}_${d.stage}_${d.messageId}`, retryTag);
  }

  cadenceJobId(d: CadenceStepJob, retryTag?: string): string {
    return this.withTag(`cadence_${d.leadId}_${d.anchor}`, retryTag);
  }

  // A antecedência entra no id: mudar de 24h pra 2h na config cria um job novo em vez de
  // ser descartado pelo job antigo (que, ao disparar cedo demais, só confere e sai).
  reminderJobId(d: AppointmentReminderJob, hoursBefore: number, retryTag?: string): string {
    return this.withTag(`reminder_${d.appointmentId}_${d.startMs}_${hoursBefore}h`, retryTag);
  }

  // O prazo (dias) entra no id pelo mesmo motivo da antecedência do lembrete.
  postSaleJobId(d: PostSaleJob, days: number, retryTag?: string): string {
    return this.withTag(`postsale_${d.leadId}_${d.entryId}_${days}d`, retryTag);
  }

  async schedulePostSale(d: PostSaleJob, days: number, fireAt: Date, retryTag?: string): Promise<void> {
    await this.add(JOB_POST_SALE, d, this.postSaleJobId(d, days, retryTag), fireAt);
  }

  async scheduleIdleCheck(d: IdleCheckJob, fireAt: Date, retryTag?: string): Promise<void> {
    await this.add(JOB_IDLE_CHECK, d, this.idleCheckJobId(d, retryTag), fireAt);
  }

  async scheduleCadenceStep(d: CadenceStepJob, fireAt: Date, retryTag?: string): Promise<void> {
    await this.add(JOB_CADENCE_STEP, d, this.cadenceJobId(d, retryTag), fireAt);
  }

  async scheduleReminder(d: AppointmentReminderJob, hoursBefore: number, fireAt: Date, retryTag?: string): Promise<void> {
    await this.add(JOB_APPOINTMENT_REMINDER, d, this.reminderJobId(d, hoursBefore, retryTag), fireAt);
  }

  private withTag(base: string, retryTag?: string): string {
    return retryTag ? `${base}_${retryTag}` : base;
  }

  private async add(name: string, data: object, jobId: string, fireAt: Date): Promise<void> {
    if (!this.enabled) return;
    const delay = Math.max(MIN_DELAY_MS, fireAt.getTime() - Date.now());
    await this.queue!.add(name, data, {
      jobId,
      delay,
      // Falha aqui é banco/IA/uazapi fora do ar — retry com backoff, como no dispatch.
      attempts: 3,
      backoff: { type: 'exponential', delay: 60_000 },
      // removeOnComplete libera o id: a cadência re-arma o mesmo id quando a resposta da
      // IA chega depois de um toque que teve que esperar.
      removeOnComplete: true,
      removeOnFail: { count: 200 },
    });
  }
}
