import { ALEX_HANDOFF_LABEL, ALEX_HANDOFF_TENANT_IDS, buildAlexHandoffText, normalizeNotifyPhone, shouldNotifyAlexForAiHandoff } from './alex-handoff.util';

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
    const t = buildAlexHandoffText({ name: 'Liviane Chaves', phone: '559899990000', trigger: { source: 'keyword', keyword: 'quero esse' }, customerText: 'Quero esse 50 gramas' });
    expect(t).toContain('Cliente: Liviane Chaves');
    expect(t).toContain('Conversa: https://wa.me/559899990000');
    expect(t).toContain('Ela disse: "Quero esse 50 gramas"');
    expect(t).toContain('Gatilho: "quero esse"');
    expect(t).toContain(`"${ALEX_HANDOFF_LABEL}"`);
  });

  it('sem nome usa o telefone', () => {
    const t = buildAlexHandoffText({ name: '', phone: '559899990000', trigger: { source: 'keyword', keyword: 'manda o pix' }, customerText: 'Manda o pix' });
    expect(t).toContain('Cliente: 559899990000');
  });

  it('junta várias bolhas em uma linha e corta texto longo', () => {
    const t = buildAlexHandoffText({ name: 'Ana', phone: '559899990000', trigger: { source: 'keyword', keyword: 'vou comprar' }, customerText: 'oi\n\nvou comprar|||amanhã ' + 'x'.repeat(400) });
    const disse = t.split('\n').find((l) => l.startsWith('Ela disse:'))!;
    expect(disse).toContain('oi vou comprar amanhã');
    expect(disse.length).toBeLessThan(320);
    expect(disse).toContain('…');
  });
});

describe('encaminhamento pela IA', () => {
  it('aviso mostra o que a IA respondeu no lugar do gatilho', () => {
    const t = buildAlexHandoffText({ name: 'Drika', phone: '559899990000', trigger: { source: 'ia', reply: 'Vou deixar encaminhado com o Alex pra te ajudar certinho com isso, tá bom?' }, customerText: 'Pode mi direcionar para um vendedor' });
    expect(t).toContain('A IA passou uma cliente para você!');
    expect(t).toContain('Ela disse: "Pode mi direcionar para um vendedor"');
    expect(t).toContain('A IA respondeu: "Vou deixar encaminhado com o Alex');
    expect(t).not.toContain('Gatilho:');
  });
  it('não avisa o Alex quando a IA desligou por xingamento, emergência ou lixo', () => {
    expect(shouldNotifyAlexForAiHandoff(['qualificado'])).toBe(true);
    expect(shouldNotifyAlexForAiHandoff(undefined)).toBe(true);
    expect(shouldNotifyAlexForAiHandoff(['reclamacao'])).toBe(true);
    expect(shouldNotifyAlexForAiHandoff(['desrespeitoso'])).toBe(false);
    expect(shouldNotifyAlexForAiHandoff(['qualificado', 'Fora-de-Escopo'])).toBe(false);
  });
  it('só vale para a S&A', () => {
    expect(ALEX_HANDOFF_TENANT_IDS.has('badfc5d9-d522-4253-a788-28b3ebe41753')).toBe(true);
    expect(ALEX_HANDOFF_TENANT_IDS.has('d69c3b3a-5b96-4c7d-9bce-ea7c44533d5c')).toBe(false);
  });
});
