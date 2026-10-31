import { mediaDocName, mediaSendType } from './media-send-type.util';

describe('mediaSendType', () => {
  it('PDF vai como documento, vídeo como vídeo, o resto como imagem', () => {
    expect(mediaSendType('application/pdf')).toBe('document');
    expect(mediaSendType('video/mp4')).toBe('video');
    expect(mediaSendType('image/jpeg')).toBe('image');
    expect(mediaSendType(null)).toBe('image');
  });

  it('nome do documento: só para PDF e sempre com .pdf', () => {
    expect(mediaDocName('Catalogo 2026', 'application/pdf')).toBe('Catalogo 2026.pdf');
    expect(mediaDocName('tabela.PDF', 'application/pdf')).toBe('tabela.PDF');
    expect(mediaDocName('video', 'video/mp4')).toBeUndefined();
  });
});
