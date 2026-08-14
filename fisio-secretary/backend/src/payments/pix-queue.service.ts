import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import {
  PIX_QUEUE_NAME,
  JOB_CHECK_TENANT,
  JOB_CHECK_IMPLANTACAO,
  JOB_DEEP_RECONCILE,
  QUEUE_ENGINE_BULLMQ,
} from '../queue/queue.constants';

export type PixKind = 'tenant' | 'implantacao';

// Cada checagem é um job próprio, agendado para o momento em que faz sentido perguntar
// de novo — em vez do cron varrer a tabela inteira a cada minuto enquanto houver qualquer
// pendência. O intervalo cresce a cada tentativa (20s, 40s, 60s… teto de 5min) e a cadeia
// termina sozinha quando a cobrança é confirmada ou expira.
const FIRST_CHECK_DELAY_MS = 20_000;
const CHECK_DELAY_STEP_MS = 20_000;
const CHECK_DELAY_CAP_MS = 5 * 60_000;
const DEEP_RECONCILE_EVERY_MS = 30 * 60_000;

@Injectable()
export class PixQueueService implements OnModuleInit {
  private readonly logger = new Logger(PixQueueService.name);

  constructor(
    @InjectQueue(PIX_QUEUE_NAME) private readonly queue: Queue,
    private readonly config: ConfigService,
  ) {}

  private get enabled(): boolean {
    return this.config.get<string>('QUEUE_ENGINE') === QUEUE_ENGINE_BULLMQ;
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) return;
    // Rede de segurança equivalente ao deep check de 30min do cron: reenfileira cobranças
    // pendentes que não têm cadeia ativa (criadas por outra instância, insert manual, ou
    // perdidas num restart). upsert = idempotente, pode rodar em toda réplica no boot.
    await this.queue.upsertJobScheduler(
      'pix-deep-reconcile',
      { every: DEEP_RECONCILE_EVERY_MS },
      { name: JOB_DEEP_RECONCILE, data: {} },
    );
    this.logger.log('[EFI][queue] Reconciliação periódica registrada (30min)');
  }

  // Separador é '_' e não ':' de propósito: o BullMQ rejeita jobId com ':' (reservado
  // para as chaves internas dele) — com ':' o add lança e a cadeia nunca começaria.
  private jobId(kind: PixKind, id: string, attempt?: number): string {
    return attempt === undefined ? `pix-${kind}_${id}` : `pix-${kind}_${id}_a${attempt}`;
  }

  // Primeiro elo da cadeia. jobId estável = dedupe: duas chamadas para a mesma cobrança
  // viram a mesma cadeia, e o deep reconcile só enfileira o que realmente está faltando
  // (BullMQ ignora um add cujo jobId já existe).
  async startCheckChain(kind: PixKind, id: string, txid: string): Promise<void> {
    if (!this.enabled) return;
    await this.queue.add(
      kind === 'tenant' ? JOB_CHECK_TENANT : JOB_CHECK_IMPLANTACAO,
      { id, txid, attempt: 0 },
      {
        jobId: this.jobId(kind, id),
        delay: FIRST_CHECK_DELAY_MS,
        attempts: 1, // o reagendamento é explícito (próximo elo), não retry do BullMQ
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  // Próximo elo. O jobId leva o número da tentativa porque o anterior (mesmo id base)
  // ainda pode estar sendo finalizado — sem o sufixo, o add seria descartado como duplicado.
  async scheduleNextCheck(kind: PixKind, id: string, txid: string, attempt: number): Promise<void> {
    const delay = Math.min(CHECK_DELAY_STEP_MS * (attempt + 1), CHECK_DELAY_CAP_MS);
    await this.queue.add(
      kind === 'tenant' ? JOB_CHECK_TENANT : JOB_CHECK_IMPLANTACAO,
      { id, txid, attempt },
      {
        jobId: this.jobId(kind, id, attempt),
        delay,
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }
}
