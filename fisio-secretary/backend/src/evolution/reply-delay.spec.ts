import { getReplyDelaySeconds, sanitizeReplyDelay, setReplyDelay } from './reply-delay';

describe('tempo de resposta da IA', () => {
  it('sem valor salvo: 15s, ou o tempo antigo de quem já tinha', () => {
    expect(getReplyDelaySeconds('tenant-novo')).toBe(15);
    expect(getReplyDelaySeconds('2c562828-0fe9-43c8-bad0-77a931968afc')).toBe(35);
    expect(getReplyDelaySeconds('3ff8efe4-7a7c-44ee-b98b-548e5921b174')).toBe(45);
  });

  it('valor salvo no banco vale mais; null volta ao padrão', () => {
    setReplyDelay('t1', 20);
    expect(getReplyDelaySeconds('t1')).toBe(20);
    setReplyDelay('t1', null);
    expect(getReplyDelaySeconds('t1')).toBe(15);
  });

  it('limita entre 5 e 120s e ignora lixo', () => {
    expect(sanitizeReplyDelay(1)).toBe(5);
    expect(sanitizeReplyDelay(999)).toBe(120);
    expect(sanitizeReplyDelay('30')).toBe(30);
    expect(sanitizeReplyDelay('abc')).toBeNull();
    expect(sanitizeReplyDelay(null)).toBeNull();
  });
});
