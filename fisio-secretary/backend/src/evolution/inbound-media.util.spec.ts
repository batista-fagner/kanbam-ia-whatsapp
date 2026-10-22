import { removeQueuedLines } from './inbound-media.util';

describe('removeQueuedLines', () => {
  it('tira as linhas de mídia e mantém o texto', () => {
    expect(removeQueuedLines('[imagem]\n[imagem] oi\nquero saber o preço', ['[imagem]', '[imagem] oi'])).toBe('quero saber o preço');
  });

  it('não confunde "[imagem]" com "[imagem] legenda" quando a ordem é diferente', () => {
    expect(removeQueuedLines('[imagem] oi\n[imagem]', ['[imagem]', '[imagem] oi'])).toBe('');
  });

  it('só mídia sem texto → vazio', () => {
    expect(removeQueuedLines('[imagem]\n[imagem]', ['[imagem]', '[imagem]'])).toBe('');
  });

  it('legenda de várias linhas', () => {
    expect(removeQueuedLines('olá\nlinha 1\nlinha 2\ntchau', ['linha 1\nlinha 2'])).toBe('olá\ntchau');
  });

  it('linha que não existe é ignorada', () => {
    expect(removeQueuedLines('oi', ['[vídeo]', undefined])).toBe('oi');
  });
});
