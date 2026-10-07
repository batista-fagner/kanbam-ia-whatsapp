import { splitBubbles, BUBBLE_RULE_BLOCK } from './bubble-rule';
import { EvolutionService } from '../evolution/evolution.service';
import { buildTypingPlan } from '../evolution/typing-plan';

describe('splitBubbles', () => {
  it('texto sem marcador vira uma bolha só', () => {
    expect(splitBubbles('Oi, tudo bem?')).toEqual(['Oi, tudo bem?']);
  });

  it('separa no ||| e ignora bolhas vazias', () => {
    expect(splitBubbles('Oi!||| |||Quantas gramas?')).toEqual(['Oi!', 'Quantas gramas?']);
  });

  it('nunca descarta texto além de 3 bolhas — junta o excedente na última', () => {
    expect(splitBubbles('a|||b|||c|||d')).toEqual(['a', 'b', 'c\n\nd']);
  });

  it('lista de bullets quebrada em várias bolhas volta a ser uma só', () => {
    expect(splitBubbles('Temos:|||• Liso 55cm|||• Liso 65cm|||Qual prefere?')).toEqual([
      'Temos:',
      '• Liso 55cm\n• Liso 65cm',
      'Qual prefere?',
    ]);
  });

  it('regra do prompt fala do marcador e do limite', () => {
    expect(BUBBLE_RULE_BLOCK).toContain('|||');
    expect(BUBBLE_RULE_BLOCK).toContain('150');
  });
});

describe('EvolutionService.sendTextMessage (bolhas)', () => {
  const make = () => {
    const provider = { sendTextMessage: jest.fn().mockResolvedValue(undefined), sendTypingIndicator: jest.fn().mockResolvedValue(undefined) };
    return { provider, svc: new EvolutionService(provider as any) };
  };

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('com dynamicTyping manda "digitando" antes de CADA bolha, inclusive a 1ª', async () => {
    const { provider, svc } = make();
    const p = svc.sendTextMessage('5511999', 'Oi!|||Quantas gramas?', 'tok', 'tenant-x', { dynamicTyping: true });
    await jest.runAllTimersAsync();
    await p;
    expect(provider.sendTypingIndicator).toHaveBeenCalledTimes(2);
    expect(provider.sendTextMessage.mock.calls.map((c) => c[1])).toEqual(['Oi!', 'Quantas gramas?']);
  });

  it('sem a opção mantém o comportamento antigo (sem digitando antes da 1ª)', async () => {
    const { provider, svc } = make();
    const p = svc.sendTextMessage('5511999', 'Oi!|||Tudo bem?', 'tok', 'tenant-x');
    await jest.runAllTimersAsync();
    await p;
    expect(provider.sendTypingIndicator).toHaveBeenCalledTimes(1);
    expect(provider.sendTextMessage).toHaveBeenCalledTimes(2);
  });

  it('4 bolhas não perdem texto', async () => {
    const { provider, svc } = make();
    const p = svc.sendTextMessage('5511999', 'a|||b|||c|||d', 'tok');
    await jest.runAllTimersAsync();
    await p;
    expect(provider.sendTextMessage.mock.calls.map((c) => c[1])).toEqual(['a', 'b', 'c\n\nd']);
  });
});

describe('buildTypingPlan', () => {
  const fixed = () => 0.5; // jitter = 1.0, pausas no meio da faixa

  it('frase curta: 1 trecho só, no piso de 2,5s', () => {
    expect(buildTypingPlan('Oi!', fixed)).toEqual([{ type: 'type', ms: 2500 }]);
  });

  it('frase de 146 caracteres: digita, para e volta a digitar (3 trechos, 2 pausas)', () => {
    const text = 'Trabalhamos com cabelos brasileiros, vietnamitas e indianos de alta qualidade. Temos opções lisas, onduladas e cacheadas em diversas medidas.';
    const plan = buildTypingPlan(text, fixed);
    expect(plan.map((s) => s.type)).toEqual(['type', 'pause', 'type', 'pause', 'type']);
    const typed = plan.filter((s) => s.type === 'type').reduce((n, s) => n + s.ms, 0);
    expect(typed).toBe(Math.round(text.length * 110) > 20000 ? 20000 : Math.round(text.length * 110));
    expect(typed).toBeGreaterThan(15000); // ~16s, não 3s
  });

  it('trechos nunca passam do teto e variam ±15% com o sorteio', () => {
    const t = 'x'.repeat(500);
    const sum = (r: () => number) => buildTypingPlan(t, r).filter((s) => s.type === 'type').reduce((n, s) => n + s.ms, 0);
    expect(sum(() => 0)).toBeLessThan(sum(() => 1));
    expect(sum(() => 1)).toBeLessThanOrEqual(23000);
  });
});

describe('EvolutionService com digitando humanizado', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.spyOn(Math, 'random').mockReturnValue(0.5); });
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

  it('a bolha só sai depois de todo o tempo de digitação e a seguinte espera a pausa + digitar', async () => {
    const provider = { sendTextMessage: jest.fn().mockResolvedValue(undefined), sendTypingIndicator: jest.fn().mockResolvedValue(undefined) };
    const svc = new EvolutionService(provider as any);
    const p = svc.sendTextMessage('5511999', 'Que legal!|||Quantas gramas?', 'tok', 't', { dynamicTyping: true });
    await jest.advanceTimersByTimeAsync(2499);
    expect(provider.sendTextMessage).toHaveBeenCalledTimes(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(provider.sendTextMessage).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1400 + 2499); // pausa entre bolhas (1,4s) + digitando
    expect(provider.sendTextMessage).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await p;
    expect(provider.sendTextMessage).toHaveBeenCalledTimes(2);
  });
});
