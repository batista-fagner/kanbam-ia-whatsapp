import { Logger } from '@nestjs/common';
import { PriceConfig } from '../common/entities/price-config.entity';
import { computePriceQuote, computeSizeQuote, findSizeProduct, PriceQuoteRequest, SizeQuoteRequest } from './price-calc';

const logger = new Logger('PriceQuoteApplier');

// Substitui [[PRECO:id]] no reply pelo valor calculado deterministicamente.
// Se alguma cotação falhar (produto/gramatura inválidos — não deveria
// acontecer com o prompt seguido certinho, mas o código nunca confia cegamente
// no modelo), remove o placeholder e loga um erro em vez de vazar "[[PRECO:x]]"
// pra cliente ou inventar um valor.
// Troca a frase (até . ! ? ou quebra de linha) que contém o token pela frase dada.
function replaceSentence(text: string, token: string, sentence: string): string {
  const i = text.indexOf(token);
  const before = text.slice(0, i);
  const start = Math.max(before.lastIndexOf('. '), before.lastIndexOf('! '), before.lastIndexOf('? '), before.lastIndexOf('\n'));
  const startAt = start === -1 ? 0 : start + (text[start] === '\n' ? 1 : 2);
  const rest = text.slice(i + token.length);
  const m = rest.match(/[.!?](\s|$)|\n/);
  const endAt = m ? i + token.length + (m.index ?? 0) + (m[0].startsWith('\n') ? 0 : 1) : text.length;
  return text.slice(0, startAt) + sentence + text.slice(endAt);
}

export type AnyQuoteRequest = (PriceQuoteRequest | SizeQuoteRequest) & { id: string };

export function applyPriceQuotes(reply: string, quotes: AnyQuoteRequest[] | undefined, config: PriceConfig | null): string {
  if (!config) return reply;
  let out = reply;
  for (const q of quotes ?? []) {
    const token = `[[PRECO:${q.id}]]`;
    if (!out.includes(token)) continue;
    // Produto por tamanho (sizeProducts) ou por grama (products) — a key decide.
    const result = findSizeProduct(config, q.productKey)
      ? computeSizeQuote(config, q as SizeQuoteRequest)
      : computePriceQuote(config, q as PriceQuoteRequest);
    if (result.ok) {
      // O texto já traz "à vista"/"no cartão": se a IA repetiu logo depois do placeholder, sai uma vez só.
      const low = result.text.toLowerCase();
      out = out.split(token).reduce((acc, part, i) => {
        if (i === 0) return part;
        const m = /^\s+(à vista|no cartão)/i.exec(part);
        const rest = m && low.includes(m[1].toLowerCase()) ? part.slice(m[0].length) : part;
        return acc + result.text + rest;
      }, '');
    } else if (result.text) {
      // Tamanho fora da tabela: a frase inteira do valor sai ("Ele fica [[PRECO:a]] à vista.")
      // e entra a frase pronta com os tamanhos que existem — sem preço e sem frase quebrada.
      logger.warn(`[PRICE_CALC] Tamanho fora da tabela (tenant=${config.tenantId}, id=${q.id}): ${JSON.stringify(q)}`);
      out = replaceSentence(out, token, result.text);
    } else {
      logger.error(`[PRICE_CALC] Cotação inválida (tenant=${config.tenantId}, id=${q.id}, motivo=${result.reason}): ${JSON.stringify(q)}`);
      out = out.split(token).join('');
    }
  }
  // Placeholder sem cotação correspondente (a IA escreveu [[PRECO:x]] mas não
  // mandou o item em priceQuotes) — nunca pode chegar na cliente.
  if (/\[\[PRECO:[^\]]*\]\]/.test(out)) {
    logger.error(`[PRICE_CALC] Placeholder sem cotação (tenant=${config.tenantId}): ${out}`);
    out = out.replace(/\[\[PRECO:[^\]]*\]\]/g, '');
  }
  // O texto do valor já traz a forma de pagamento; se a IA repetiu logo depois
  // do placeholder ("[[PRECO:a]] à vista"), sai "à vista à vista" — junta.
  out = out.replace(/(à vista|no cartão)(\s+\1)+/gi, '$1');
  return out.replace(/ {2,}/g, ' ').trim();
}
