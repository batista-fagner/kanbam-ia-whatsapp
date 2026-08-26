// Formatação do catálogo de mídias injetado no system prompt.
//
// Por que a LEGENDA entra no prompt: a legenda é enviada junto com o vídeo, ou
// seja, é literalmente o que a cliente lê na tela — e no MegaHair ela carrega o
// preço por 100g do produto. Antes só o NOME ia pro prompt, então a IA anunciava
// um preço no vídeo e citava outro no texto.
//
// Bug real (S&A Cabelos Naturais, 25-26/08/2026): "Indiano Liso Extremo 57 cm"
// tinha vídeo com legenda "389,90 / 100 Gramas" mas não existia na tabela de
// preços do módulo. A IA não percebia a ausência — pegava a linha mais parecida
// da tabela (o Vietnamita Liso Extremo 60cm, R$649,90) e ainda dizia pra cliente
// que o preço do próprio anúncio "não corresponde". Aconteceu com pelo menos 2
// leads no mesmo dia, e o mesmo padrão atingiu o "Cacheado 45 cm" (legenda
// R$379,90, cotado como R$429,90 — preço do cacheado 55cm).
export type CatalogEntry = { name: string; caption?: string | null };

const cap = (e: CatalogEntry) => (e.caption ?? '').replace(/\s*\n\s*/g, ' | ').trim();

export function buildCatalogLines(media: CatalogEntry[]): string {
  return media
    .map((m) => {
      const c = cap(m);
      return `- "${m.name}"${c ? `\n    legenda que a cliente vê no vídeo: ${c}` : ''}`;
    })
    .join('\n');
}

export const hasAnyCaption = (media: CatalogEntry[]) => media.some((m) => cap(m).length > 0);

// Só é anexada quando ao menos uma mídia tem legenda — para tenants sem legenda
// cadastrada o prompt continua idêntico ao de antes (nenhuma regra nova, nenhum
// custo de token, cache do prefixo preservado).
export const CAPTION_PRICE_RULE = `
🔴 REGRA CRÍTICA — O PREÇO DA LEGENDA É O PREÇO OFICIAL DO PRODUTO
A legenda acima é enviada JUNTO com o vídeo, então é EXATAMENTE o que a cliente lê na tela. O valor que aparece na legenda é o valor à vista por 100g daquele produto e é a FONTE DE VERDADE do preço dele.
- Ao informar o preço de um produto que tem vídeo no catálogo, use o valor da LEGENDA dele, copiado dígito por dígito.
- Se a tabela de preços mostrar um valor diferente da legenda do mesmo produto, a LEGENDA VENCE.
- PROIBIDO usar o preço de um produto para outro produto, mesmo que os nomes sejam parecidos (ex.: "Liso Extremo 57cm" e "Liso Extremo 60cm" são produtos DIFERENTES, com preços DIFERENTES).
- PROIBIDO dizer que um valor citado pela cliente "não corresponde" / "não é válido" / "não existe" se esse valor aparece na legenda de algum produto do catálogo acima. Se ela citar um valor que está numa legenda, confirme que é o valor daquele produto.`;
