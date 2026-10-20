import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

type QueueCallback = (combinedText: string) => void | Promise<unknown>;

interface QueueEntry {
  messages: string[];
  timer: ReturnType<typeof setTimeout>;
  callback: QueueCallback;
}

// Teto de espera por uma resposta em andamento antes de liberar a próxima — se o
// processamento travar, a cliente não fica sem resposta pra sempre.
const MAX_PROCESSING_LOCK_MS = 3 * 60 * 1000;

// Debounce por tenant maior que o padrão — pedido pontual da demo de prospecção
// ativa (claudia_teste@hotmail.com), o cliente dele costuma mandar várias mensagens
// picadas e quer mais margem pra IA juntar tudo antes de responder. Não generalizar.
// alex_teste (e624e817...): debounce reduzido pra 5s pra agilizar os testes
// de reconhecimento de imagem no tenant sandbox — não generalizar.
// Heline / HE Cabelos (3ff8efe4...): 45s — pedido do Fagner (19/10/2026), as clientes
// mandam a frase picada em várias mensagens e a IA respondia antes de ler tudo.
const TENANT_DEBOUNCE_OVERRIDES_MS: Record<string, number> = {
  '1ff3f0b3-52d1-4e89-b7bf-552d0556de29': 25000,
  'e624e817-5b6c-4840-b0ea-269eb78afe8d': 5000,
  '3ff8efe4-7a7c-44ee-b98b-548e5921b174': 45000,
  '69420c85-634c-451d-af45-2ebccf8aa1d3': 30000, // Mult Festa — clientes mandam data/tema/local em várias mensagens
};

@Injectable()
export class MessageQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(MessageQueueService.name);
  private readonly DEBOUNCE_MS = 15000;
  private readonly queues = new Map<string, QueueEntry>();
  // Uma resposta por cliente de cada vez: enquanto a IA ainda está respondendo
  // (20-40s com mídia/bolhas), mensagens que chegam e passam do debounce esperam
  // aqui e saem juntas numa resposta só, depois que a anterior terminar. Sem isso,
  // duas respostas rodavam em paralelo sem ver uma à outra — preço repetido,
  // pergunta já respondida de novo, respostas fora de ordem (HE Cabelos, 14/10/2026).
  private readonly processing = new Set<string>();
  private readonly waiting = new Map<string, { messages: string[]; callback: QueueCallback }>();

  // `phone` aqui é a queueKey `${tenantId}:${phone}` (ver evolution.controller.ts) —
  // extrai o tenantId do prefixo pra decidir o debounce sem mudar a assinatura do método.
  enqueue(phone: string, text: string, callback: QueueCallback): void {
    const existing = this.queues.get(phone);

    if (existing) {
      clearTimeout(existing.timer);
      existing.messages.push(text);
      existing.callback = callback;
      this.logger.debug(`[${phone}] mensagem acumulada (${existing.messages.length} total), timer reiniciado`);
    } else {
      this.queues.set(phone, { messages: [text], timer: null as any, callback });
      this.logger.debug(`[${phone}] nova fila criada`);
    }

    const tenantId = phone.split(':')[0];
    const debounceMs = TENANT_DEBOUNCE_OVERRIDES_MS[tenantId] ?? this.DEBOUNCE_MS;

    const entry = this.queues.get(phone)!;
    entry.timer = setTimeout(() => {
      const combined = entry.messages.join('\n');
      this.logger.log(`[${phone}] debounce disparado — ${entry.messages.length} msg(s): "${combined}"`);
      this.queues.delete(phone);
      this.dispatch(phone, entry.messages, entry.callback);
    }, debounceMs);
  }

  private dispatch(phone: string, messages: string[], callback: QueueCallback): void {
    if (this.processing.has(phone)) {
      const w = this.waiting.get(phone);
      if (w) {
        w.messages.push(...messages);
        w.callback = callback;
      } else {
        this.waiting.set(phone, { messages: [...messages], callback });
      }
      this.logger.log(`[${phone}] resposta anterior ainda em andamento — ${messages.length} msg(s) aguardando`);
      return;
    }

    this.processing.add(phone);
    let lockTimer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      lockTimer = setTimeout(() => {
        this.logger.warn(`[${phone}] resposta passou de ${MAX_PROCESSING_LOCK_MS / 1000}s — liberando a fila`);
        resolve();
      }, MAX_PROCESSING_LOCK_MS);
    });
    const run = Promise.resolve()
      .then(() => callback(messages.join('\n')))
      .catch((err) => this.logger.error(`[${phone}] erro no processamento: ${err?.message ?? err}`));

    Promise.race([run, timeout]).finally(() => {
      clearTimeout(lockTimer);
      this.processing.delete(phone);
      const next = this.waiting.get(phone);
      if (next) {
        this.waiting.delete(phone);
        this.logger.log(`[${phone}] processando ${next.messages.length} msg(s) que aguardavam`);
        this.dispatch(phone, next.messages, next.callback);
      }
    });
  }

  onModuleDestroy() {
    for (const [phone, entry] of this.queues) {
      clearTimeout(entry.timer);
      this.logger.warn(`[${phone}] fila descartada no shutdown`);
    }
    this.queues.clear();
    this.waiting.clear();
  }
}
