import { PriceConfig, SizeProduct } from '../common/entities/price-config.entity';

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
  reason: 'produto_desconhecido' | 'gramatura_invalida' | 'gramatura_fora_do_passo' | 'tamanho_indisponivel';
  // Só em tamanho_indisponivel: frase pra entrar no lugar do placeholder
  // (os tamanhos que existem), em vez de sumir com o valor e deixar a frase quebrada.
  text?: string;
}

// Cotação de produto vendido por tamanho (ver PriceConfig.sizeProducts).
export interface SizeQuoteRequest {
  productKey: string;
  cm: number;
  payment: PaymentMethod;
}

export interface SizeQuoteResult {
  ok: true;
  productLabel: string;
  cm: number;
  total: number;
  payment: PaymentMethod;
  text: string;
}

const BRL = (v: number) => `R$${v.toFixed(2).replace('.', ',')}`;

export function findProduct(config: PriceConfig, key: string) {
  return config.products.find((p) => p.key === key);
}

export function findSizeProduct(config: PriceConfig, key: string): SizeProduct | undefined {
  return (config.sizeProducts ?? []).find((p) => p.key === key);
}

// Tabela tem algo cotável? (por grama OU por tamanho) — decide se o bloco de
// preço e o campo priceQuotes entram no prompt.
export function hasPriceTable(config: PriceConfig | null | undefined): boolean {
  return !!(config?.isActive && ((config.products?.length ?? 0) > 0 || (config.sizeProducts?.length ?? 0) > 0));
}

const cmList = (p: SizeProduct) => {
  const cms = [...p.sizes].sort((a, b) => a.cm - b.cm).map((s) => String(s.cm));
  return (cms.length > 1 ? `${cms.slice(0, -1).join(', ')} e ${cms[cms.length - 1]}` : cms[0]) + 'cm';
};

// Produto por tamanho: o valor é LIDO da tabela, nunca calculado. Cartão usa o
// valor de cartão do tamanho; sem ele, devolve o à vista avisando do acréscimo
// (a loja informou "cartão com acréscimo" sem dizer quanto).
export function computeSizeQuote(config: PriceConfig, req: SizeQuoteRequest): SizeQuoteResult | PriceQuoteError {
  const product = findSizeProduct(config, req.productKey);
  if (!product) return { ok: false, reason: 'produto_desconhecido' };
  const size = product.sizes.find((s) => s.cm === Number(req.cm));
  if (!size) {
    return { ok: false, reason: 'tamanho_indisponivel', text: `Esse tamanho não temos nessa linha — temos ${cmList(product)}. Qual você prefere?` };
  }
  const price = Number(size.price);
  const card = size.cardPrice == null ? null : Number(size.cardPrice);
  if (req.payment === 'cartao') {
    if (card != null) {
      return { ok: true, productLabel: product.label, cm: size.cm, total: card, payment: 'cartao', text: `${BRL(card)} no cartão` };
    }
    return { ok: true, productLabel: product.label, cm: size.cm, total: price, payment: 'cartao', text: `${BRL(price)} à vista (no cartão tem acréscimo)` };
  }
  return { ok: true, productLabel: product.label, cm: size.cm, total: price, payment: 'vista', text: `${BRL(price)} à vista` };
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
function buildGramCatalogBlock(config: PriceConfig): string {
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

// Bloco por tamanho: lista só os TAMANHOS de cada produto, nunca os valores —
// sem o número no prompt a IA não tem como copiar o valor da linha errada
// (o erro típico de tabela por comprimento); o valor sempre vem do código.
function buildSizeCatalogBlock(config: PriceConfig): string {
  const lines = config.sizeProducts.map((p) => {
    const hasCard = p.sizes.some((s) => s.cardPrice != null);
    return `- key: "${p.key}" | ${p.label} | tamanhos: ${cmList(p)}${hasCard ? ' | tem valor próprio no cartão' : ''}`;
  }).join('\n');
  return `
════════ TABELA DE PREÇOS POR TAMANHO (valor automático — LEIA COM ATENÇÃO) ════════
${lines}

🔴 REGRA — VOCÊ NÃO ESCREVE VALOR. Os valores desses cabelos NÃO estão no prompt: quem coloca o valor é o sistema.

Quando for informar o preço (produto e tamanho já claros na conversa):
1. Adicione ao JSON o campo "priceQuotes" com um item por valor: {"id": "a", "productKey": "<key exata da lista acima>", "cm": <tamanho em cm, número>, "payment": "vista"|"cartao"}. Use ids curtos (a, b, c...).
2. No "reply", no lugar EXATO do valor, escreva [[PRECO:a]] (com o id usado). Nunca escreva "R$" nem número de preço você mesma — o placeholder já vira o texto completo (valor + "à vista" ou "no cartão"), então não escreva "à vista"/"no cartão" logo depois dele.
   Ex.: "O Indiano Premium de 65cm fica [[PRECO:a]] 😊 Quer que eu te passe também o de 55cm?"
3. Vários tamanhos ou vista + cartão na mesma resposta: um item para cada (a, b, c...).
4. "payment" é "vista" a não ser que a cliente pergunte do cartão. Se o produto "tem valor próprio no cartão", pode cotar os dois (vista e cartao).
5. Só cote tamanho que aparece na lista daquele produto. Se ela pedir outro tamanho, diga os tamanhos que existem e pergunte qual prefere — sem placeholder.
6. Produto ou tamanho ainda não claros → NÃO use priceQuotes nem placeholder: pergunte primeiro.`;
}

export function buildPriceCatalogBlock(config: PriceConfig): string {
  const parts: string[] = [];
  if (config.products?.length) parts.push(buildGramCatalogBlock(config));
  if (config.sizeProducts?.length) parts.push(buildSizeCatalogBlock(config));
  return parts.join('\n');
}
