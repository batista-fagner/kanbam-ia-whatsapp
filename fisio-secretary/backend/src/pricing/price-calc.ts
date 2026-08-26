import { PriceConfig } from '../common/entities/price-config.entity';

// Motor de cálculo determinístico de preço por gramatura — existe pra tirar a
// aritmética da mão da IA (ver PriceConfig). Espelha as fórmulas que já
// estavam escritas em texto no módulo "Preço & Gramatura" do S&A:
//   cabelo = price100g × gramas ÷ 100
//   tela   = gramas × telaPerGram                (se quer_tela)
//   cartão = + cartaoSurchargePer100g × gramas ÷ 100   (se pagamento=cartao)
//   espécie= − especieDiscountPer100g × gramas ÷ 100   (se pagamento=especie)
//   total  = cabelo (+ ajuste de pagamento) + tela

export type PaymentMethod = 'vista' | 'cartao' | 'especie';

export interface PriceQuoteRequest {
  productKey: string;
  gramas: number;
  tela: boolean;
  payment: PaymentMethod;
}

export interface PriceQuoteResult {
  ok: true;
  productLabel: string;
  gramas: number;
  cabelo: number;
  tela: number;
  total: number;
  payment: PaymentMethod;
  // Frase pronta, no mesmo formato que a IA já usava em texto — é isso que
  // substitui o placeholder na reply.
  text: string;
}

export interface PriceQuoteError {
  ok: false;
  reason: 'produto_desconhecido' | 'gramatura_invalida' | 'gramatura_fora_do_passo';
}

const BRL = (v: number) => `R$${v.toFixed(2).replace('.', ',')}`;

export function findProduct(config: PriceConfig, key: string) {
  return config.products.find((p) => p.key === key);
}

export function computePriceQuote(config: PriceConfig, req: PriceQuoteRequest): PriceQuoteResult | PriceQuoteError {
  const product = findProduct(config, req.productKey);
  if (!product) return { ok: false, reason: 'produto_desconhecido' };

  if (!Number.isFinite(req.gramas) || req.gramas < config.minGram) {
    return { ok: false, reason: 'gramatura_invalida' };
  }
  if (config.gramStep > 0 && req.gramas % config.gramStep !== 0) {
    return { ok: false, reason: 'gramatura_fora_do_passo' };
  }

  const base100g = Number(product.price100g);
  let cabelo = (base100g * req.gramas) / 100;

  if (req.payment === 'cartao' && config.cartaoSurchargePer100g != null) {
    cabelo += (Number(config.cartaoSurchargePer100g) * req.gramas) / 100;
  } else if (req.payment === 'especie' && config.especieDiscountPer100g != null) {
    cabelo -= (Number(config.especieDiscountPer100g) * req.gramas) / 100;
  }

  const tela = req.tela && config.telaPerGram != null ? Number(config.telaPerGram) * req.gramas : 0;
  const total = cabelo + tela;

  const paymentLabel = req.payment === 'cartao' ? ' no cartão' : req.payment === 'especie' ? ' em espécie' : ' à vista';
  const text = tela > 0
    ? `${BRL(total)}${paymentLabel} (${BRL(cabelo)} do cabelo + ${BRL(tela)} da tela)`
    : `${BRL(total)}${paymentLabel}`;

  return { ok: true, productLabel: product.label, gramas: req.gramas, cabelo, tela, total, payment: req.payment, text };
}

// ─────────── Bloco de prompt: catálogo de produtos + regra de uso ───────────
// Injetado só quando o tenant tem PriceConfig ativa com produtos cadastrados.
// A IA continua fazendo o que faz bem (identificar produto/gramatura/forma de
// pagamento pela conversa) — quem multiplica e soma é o código, nunca o modelo.
export function buildPriceCatalogBlock(config: PriceConfig): string {
  const lines = config.products.map((p) => `- key: "${p.key}" | ${p.label} | R$${Number(p.price100g).toFixed(2).replace('.', ',')} / 100g`).join('\n');
  const telaLine = config.telaPerGram != null ? `- Tela: acréscimo de R$${Number(config.telaPerGram).toFixed(2).replace('.', ',')} por grama.` : '- Não existe tela pra esse catálogo.';
  const cartaoLine = config.cartaoSurchargePer100g != null ? `- Cartão: acréscimo de R$${Number(config.cartaoSurchargePer100g).toFixed(2).replace('.', ',')} a cada 100g.` : '- Não existe pagamento no cartão pra esse catálogo.';
  const especieLine = config.especieDiscountPer100g != null ? `- Espécie (dinheiro/pix, SE a cliente pedir desconto): abate R$${Number(config.especieDiscountPer100g).toFixed(2).replace('.', ',')} a cada 100g.` : '- Não existe desconto em espécie pra esse catálogo.';

  return `
════════ TABELA DE PREÇOS (cálculo automático — LEIA COM ATENÇÃO) ════════
${lines}

${telaLine}
${cartaoLine}
${especieLine}

Venda em múltiplos de ${config.gramStep}g, gramatura mínima ${config.minGram}g.

🔴 REGRA — VOCÊ NÃO FAZ CONTA. NUNCA escreva um valor em R$ no "reply" quando o preço depende de gramatura.

Quando for informar o preço de um produto que a cliente já identificou (produto claro + gramatura clara):
1. No campo "priceQuotes" do JSON, adicione um item: {"id": "a", "productKey": "<key exata da tabela acima>", "gramas": <número>, "tela": <true se ela quer a tela / false se não>, "payment": "vista"|"cartao"|"especie"}. Use um "id" curto (a, b, c...) — um por produto/gramatura cotado nesta resposta (pode cotar vários de uma vez).
2. No "reply", no lugar EXATO onde o valor entraria, escreva o placeholder [[PRECO:a]] (troque "a" pelo id usado) — nunca escreva o número você mesma. Ex.: "À vista, 150g desse cabelo fica [[PRECO:a]]. O ideal é confirmar a quantidade com sua profissional, viu?"
3. O sistema substitui [[PRECO:a]] pelo valor certo automaticamente antes de enviar. NUNCA invente o formato do valor, NUNCA escreva "R$" perto do placeholder (o placeholder já vira o texto completo, ex: "R$734,85 à vista (R$584,85 do cabelo + R$150,00 da tela)").
4. Se o produto OU a gramatura ainda não estiverem claros, NÃO use priceQuotes nem placeholder — pergunte primeiro (mesma regra de sempre: nunca adivinhe produto ou quantidade).
5. Se a cliente não mencionou explicitamente que quer a tela, assuma tela:false, SEM comentar sobre a tela. Só pergunte ou calcule com tela quando ela pedir "com a tela"/"já na tela"/"colocado na tela" ou similar. Se ela pedir explicitamente "sem a tela", use tela:false mesmo que o padrão da loja seja aplicar.
6. "payment" é "vista" a não ser que a cliente peça cartão explicitamente (→"cartao") ou peça desconto pagando em dinheiro/pix/espécie (→"especie"). Nunca ofereça desconto em espécie sem ela pedir.`;
}
