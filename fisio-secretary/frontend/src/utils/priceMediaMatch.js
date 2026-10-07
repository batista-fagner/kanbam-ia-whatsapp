// Aviso visual "falta cadastrar do outro lado" entre Mídias e Tabela de Preços.
// Comparação por sobreposição de palavras-chave, tudo no navegador — não chama
// IA nem o backend, então não tem custo nenhum. É só um lembrete: pode deixar
// passar algum caso (nome muito diferente) ou avisar à toa (nome parecido mas
// produto diferente) — nunca bloqueia nada.

// Palavras estruturais que não ajudam a identificar o produto (ignoradas na
// comparação). Números e palavras como "liso"/"ondulado"/"70cm" continuam valendo.
const STOPWORDS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'com', 'sem', 'para', 'pra', 'por', 'em', 'no', 'na',
  'nos', 'nas', 'um', 'uma', 'uns', 'umas', 'o', 'a', 'os', 'as', 'e', 'ou', 'novo', 'nova',
  'video', 'foto', 'cabelo', 'cliente',
])

function normalize(str) {
  return String(str ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove acento
    .toLowerCase()
}

export function tokenize(str) {
  return new Set(
    normalize(str)
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
  )
}

// true se `label` tem pelo menos uma palavra-chave em comum com algum item de `candidates`.
// candidates vazio (nenhum produto/mídia cadastrado do outro lado) nunca gera aviso.
export function hasKeywordMatch(label, candidates) {
  if (candidates.length === 0) return true // outro lado sem nenhum cadastro, não acusa falta
  const tokens = tokenize(label)
  if (tokens.size === 0) return true // nada pra comparar, não acusa falta
  return candidates.some((c) => {
    for (const t of tokenize(c)) if (tokens.has(t)) return true
    return false
  })
}
