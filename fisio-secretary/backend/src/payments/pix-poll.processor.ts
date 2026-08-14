import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PaymentsService } from './payments.service';
import { PixQueueService, PixKind } from './pix-queue.service';
import {
  PIX_QUEUE_NAME,
  JOB_CHECK_TENANT,
  JOB_DEEP_RECONCILE,
} from '../queue/queue.constants';

interface PixCheckData {
  id: string;
  txid: string;
  attempt: number;
}

// Substitui o corpo do pollPendingPix: em vez de um tick varrer todas as cobranças
// pendentes, cada job cuida de uma só. A decisão (pago / expirado / ainda esperando)
// continua no PaymentsService — aqui só se decide se a cadeia continua.
@Processor(PIX_QUEUE_NAME, { concurrency: 10 })
export class PixPollProcessor extends WorkerHost {
  private readonly logger = new Logger(PixPollProcessor.name);

  constructor(
    private readonly payments: PaymentsService,
    private readonly pixQueue: PixQueueService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === JOB_DEEP_RECONCILE) return this.deepReconcile();

    const kind: PixKind = job.name === JOB_CHECK_TENANT ? 'tenant' : 'implantacao';
    const { id, txid, attempt } = job.data as PixCheckData;

    let result: 'confirmed' | 'expired' | 'pending';
    try {
      result =
        kind === 'tenant'
          ? await this.payments.checkAndReconcileTenantPix(id, txid)
          : await this.payments.checkAndReconcileImplantacaoPix(id, txid);
    } catch (err) {
      // Mesma postura do cron: falha de rede/Efí não encerra a cobrança nem derruba o
      // worker — só adia a resposta para o próximo elo.
      this.logger.error(`[EFI][queue] Falha ao checar ${kind} ${id}: ${err.message}`);
      result = 'pending';
    }

    if (result !== 'pending') return; // confirmado ou expirado → cadeia encerrada

    // Quem decide "parar de tentar" é a expiração lida do banco (checkAndReconcile*),
    // nunca a idade do job — por isso não há teto de tentativas aqui.
    await this.pixQueue.scheduleNextCheck(kind, id, txid, attempt + 1);
  }

  private async deepReconcile(): Promise<void> {
    const { tenants, implantacoes } = await this.payments.listPendingPixTargets();
    for (const t of tenants) await this.pixQueue.startCheckChain('tenant', t.id, t.txid);
    for (const p of implantacoes) await this.pixQueue.startCheckChain('implantacao', p.id, p.txid);
    const total = tenants.length + implantacoes.length;
    if (total > 0) this.logger.log(`[EFI][queue] Reconciliação: ${total} cobrança(s) pendente(s) verificada(s)`);
  }
}
