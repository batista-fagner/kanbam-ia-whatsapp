// Mídia recebida do lead (foto/vídeo/documento) que já foi salva como mensagem própria
// (com a URL do arquivo). A fila de debounce junta tudo numa linha só por lead
// ("[imagem]\n[imagem] oi\ntexto"); esta função tira dessa junção as linhas que já
// viraram mensagem de mídia, sobrando só o texto "de verdade" pra salvar à parte.
export function removeQueuedLines(combined: string, queued: Array<string | undefined>): string {
  let lines = combined.split('\n');
  let asText = combined;
  for (const q of queued) {
    if (!q) continue;
    if (!q.includes('\n')) {
      const idx = lines.indexOf(q);
      if (idx >= 0) {
        lines.splice(idx, 1);
        asText = lines.join('\n');
        continue;
      }
    }
    // Legenda de várias linhas: remove pelo texto inteiro.
    const i = asText.indexOf(q);
    if (i >= 0) {
      let start = i;
      let end = i + q.length;
      if (asText[end] === '\n') end += 1;
      else if (start > 0 && asText[start - 1] === '\n') start -= 1;
      asText = asText.slice(0, start) + asText.slice(end);
      lines = asText.split('\n');
    }
  }
  return asText.trim();
}
