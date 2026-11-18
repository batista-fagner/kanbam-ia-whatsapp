import { ALEX_HANDOFF_LABEL, buildAlexHandoffText, normalizeNotifyPhone } from './alex-handoff.util';

describe('normalizeNotifyPhone', () => {
  it('põe o 55 no número brasileiro sem DDI (como está salvo o número do Alex)', () => {
    expect(normalizeNotifyPhone('98991234567')).toBe('5598991234567');
    expect(normalizeNotifyPhone('(98) 99123-4567')).toBe('5598991234567');
    expect(normalizeNotifyPhone('9833334444')).toBe('559833334444');
  });
  it('mantém quem já tem DDI e ignora vazio', () => {
    expect(normalizeNotifyPhone('5598991234567')).toBe('5598991234567');
    expect(normalizeNotifyPhone('+55 98 99123-4567')).toBe('5598991234567');
    expect(normalizeNotifyPhone('')).toBe('');
    expect(normalizeNotifyPhone(null)).toBe('');
  });
});

describe('buildAlexHandoffText', () => {
  it('traz nome, link direto da conversa, o que ela disse, o gatilho e a etiqueta', () => {
    const t = buildAlexHandoffText({ name: 'Liviane Chaves', phone: '559899990000', keyword: 'quero esse', customerText: 'Quero esse 50 gramas' });
    expect(t).toContain('Cliente: Liviane Chaves');
    expect(t).toContain('Conversa: https://wa.me/559899990000');
    expect(t).toContain('Ela disse: "Quero esse 50 gramas"');
    expect(t).toContain('Gatilho: "quero esse"');
    expect(t).toContain(`"${ALEX_HANDOFF_LABEL}"`);
  });

  it('sem nome usa o telefone', () => {
    const t = buildAlexHandoffText({ name: '', phone: '559899990000', keyword: 'manda o pix', customerText: 'Manda o pix' });
    expect(t).toContain('Cliente: 559899990000');
  });

  it('junta várias bolhas em uma linha e corta texto longo', () => {
    const t = buildAlexHandoffText({ name: 'Ana', phone: '559899990000', keyword: 'vou comprar', customerText: 'oi\n\nvou comprar|||amanhã ' + 'x'.repeat(400) });
    const disse = t.split('\n').find((l) => l.startsWith('Ela disse:'))!;
    expect(disse).toContain('oi vou comprar amanhã');
    expect(disse.length).toBeLessThan(320);
    expect(disse).toContain('…');
  });
});
