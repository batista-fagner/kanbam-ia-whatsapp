// Tipo de envio no WhatsApp (uazapi /send/media) a partir do mime da mídia do catálogo.
// PDF sobe como mídia e vai como documento (com o nome do arquivo), nunca como imagem.
export type MediaSendType = 'image' | 'video' | 'document';

export const isPdfMime = (mime?: string | null): boolean => mime === 'application/pdf';

export function mediaSendType(mime?: string | null): MediaSendType {
  if (mime?.startsWith('video/')) return 'video';
  if (isPdfMime(mime)) return 'document';
  return 'image';
}

// Nome que a cliente vê no WhatsApp: o nome da mídia no catálogo + ".pdf".
export function mediaDocName(name: string, mime?: string | null): string | undefined {
  if (!isPdfMime(mime)) return undefined;
  const base = name.trim() || 'documento';
  return /\.pdf$/i.test(base) ? base : `${base}.pdf`;
}
