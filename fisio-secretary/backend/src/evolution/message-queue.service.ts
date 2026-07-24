import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

interface QueueEntry {
  messages: string[];
  timer: ReturnType<typeof setTimeout>;
  callback: (combinedText: string) => void;
}

// Debounce por tenant maior que o padrão — pedido pontual da demo de prospecção
// ativa (claudia_teste@hotmail.com), o cliente dele costuma mandar várias mensagens
// picadas e quer mais margem pra IA juntar tudo antes de responder. Não generalizar.
const TENANT_DEBOUNCE_OVERRIDES_MS: Record<string, number> = {
  '1ff3f0b3-52d1-4e89-b7bf-552d0556de29': 25000,
};

@Injectable()
export class MessageQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(MessageQueueService.name);
  private readonly DEBOUNCE_MS = 10000;
  private readonly queues = new Map<string, QueueEntry>();

  // `phone` aqui é a queueKey `${tenantId}:${phone}` (ver evolution.controller.ts) —
  // extrai o tenantId do prefixo pra decidir o debounce sem mudar a assinatura do método.
  enqueue(phone: string, text: string, callback: (combinedText: string) => void): void {
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
      entry.callback(combined);
    }, debounceMs);
  }

  onModuleDestroy() {
    for (const [phone, entry] of this.queues) {
      clearTimeout(entry.timer);
      this.logger.warn(`[${phone}] fila descartada no shutdown`);
    }
    this.queues.clear();
  }
}
