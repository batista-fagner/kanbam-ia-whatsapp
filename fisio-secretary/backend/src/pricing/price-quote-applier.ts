import { Logger } from '@nestjs/common';
import { PriceConfig } from '../common/entities/price-config.entity';
import { computePriceQuote, PriceQuoteRequest } from './price-calc';

const logger = new Logger('PriceQuoteApplier');

// Substitui [[PRECO:id]] no reply pelo valor calculado deterministicamente.
// Se alguma cotação falhar (produto/gramatura inválidos — não deveria
// acontecer com o prompt seguido certinho, mas o código nunca confia cegamente
// no modelo), remove o placeholder e loga um erro em vez de vazar "[[PRECO:x]]"
// pra cliente ou inventar um valor.
export function applyPriceQuotes(reply: string, quotes: (PriceQuoteRequest & { id: string })[] | undefined, config: PriceConfig | null): string {
  if (!quotes?.length || !config) return reply;
  let out = reply;
  for (const q of quotes) {
    const token = `[[PRECO:${q.id}]]`;
    if (!out.includes(token)) continue;
    const result = computePriceQuote(config, q);
    if (result.ok) {
      out = out.split(token).join(result.text);
    } else {
      logger.error(`[PRICE_CALC] Cotação inválida (tenant=${config.tenantId}, id=${q.id}, motivo=${result.reason}): ${JSON.stringify(q)}`);
      out = out.split(token).join('');
    }
  }
  return out.replace(/ {2,}/g, ' ').trim();
}
