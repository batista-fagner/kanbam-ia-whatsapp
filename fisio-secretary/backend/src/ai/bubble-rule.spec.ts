import { splitBubbles, BUBBLE_RULE_BLOCK } from './bubble-rule';
import { EvolutionService } from '../evolution/evolution.service';

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

  it('bolha curta ainda espera >= 2s digitando, mais a pausa de 0,8s entre bolhas', async () => {
    const { provider, svc } = make();
    const p = svc.sendTextMessage('5511999', 'Que legal!|||Quantas gramas?', 'tok', 'tenant-x', { dynamicTyping: true });
    await jest.advanceTimersByTimeAsync(1999);
    expect(provider.sendTextMessage).toHaveBeenCalledTimes(0); // 1ª bolha só sai depois de digitar
    await jest.advanceTimersByTimeAsync(1);
    expect(provider.sendTextMessage).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(800 + 1999);
    expect(provider.sendTextMessage).toHaveBeenCalledTimes(1); // 2ª bolha ainda digitando
    await jest.advanceTimersByTimeAsync(1);
    await p;
    expect(provider.sendTextMessage).toHaveBeenCalledTimes(2);
  });
});
