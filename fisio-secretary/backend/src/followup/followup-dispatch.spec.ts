import { FollowupDispatchProcessor } from './followup-dispatch.processor';

// As proteções anti-bloqueio do processDue() (janela de horário, teto diário, espaçamento
// de 3min por tenant) são o que impede a conta de WhatsApp ser derrubada por rajada.
// Migrar pra fila não pode afrouxar nenhuma delas — só muda "deixa pending pro próximo
// tick" para "reagenda o job".
describe('FollowupDispatchProcessor — proteções preservadas na fila', () => {
  let repo: any;
  let followups: any;
  let queue: any;
  let processor: FollowupDispatchProcessor;

  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
  const pending = (over: any = {}) => ({ id: 'f1', tenantId: 't1', phone: '5511', status: 'pending', ...over });
  const job = (followupId = 'f1', extra: any = {}) => ({ data: { followupId }, ...extra }) as any;

  beforeEach(() => {
    repo = { findOne: jest.fn().mockResolvedValue(pending()), update: jest.fn() };
    followups = {
      isWithinBusinessHours: jest.fn().mockReturnValue(true),
      countSentTodayByTenant: jest.fn().mockResolvedValue(0),
      followupDailyLimit: jest.fn().mockResolvedValue(30),
      lastSentAtByTenant: jest.fn().mockResolvedValue(null),
      claimAndSend: jest.fn().mockResolvedValue('sent'),
    };
    queue = { enqueue: jest.fn(), requeue: jest.fn(), cancel: jest.fn() };
    processor = new FollowupDispatchProcessor(repo, followups, queue);
  });

  it('caminho feliz: envia via claimAndSend', async () => {
    await processor.process(job());
    expect(followups.claimAndSend).toHaveBeenCalledTimes(1);
    expect(queue.requeue).not.toHaveBeenCalled();
  });

  // Cancelado no painel enquanto o job estava agendado — o status no banco é a autoridade.
  it('follow-up que não está mais pending é ignorado', async () => {
    repo.findOne.mockResolvedValue(pending({ status: 'canceled' }));
    await processor.process(job());
    expect(followups.claimAndSend).not.toHaveBeenCalled();
  });

  it('follow-up apagado do banco não quebra o worker', async () => {
    repo.findOne.mockResolvedValue(null);
    await processor.process(job());
    expect(followups.claimAndSend).not.toHaveBeenCalled();
  });

  it('fora da janela de horário → reagenda, não envia', async () => {
    followups.isWithinBusinessHours.mockReturnValue(false);
    await processor.process(job());
    expect(followups.claimAndSend).not.toHaveBeenCalled();
    expect(queue.requeue).toHaveBeenCalledWith('f1', 5 * 60_000);
  });

  it('teto diário do tenant atingido → reagenda, não envia', async () => {
    followups.countSentTodayByTenant.mockResolvedValue(30);
    followups.followupDailyLimit.mockResolvedValue(30);
    await processor.process(job());
    expect(followups.claimAndSend).not.toHaveBeenCalled();
    expect(queue.requeue).toHaveBeenCalledWith('f1', 5 * 60_000);
  });

  // Aqui dá pra calcular o instante exato em que a janela abre, então o job volta na hora
  // certa em vez de ficar reperguntando.
  it('espaçamento de 3min por tenant → reagenda exatamente pro tempo restante', async () => {
    followups.lastSentAtByTenant.mockResolvedValue(minutesAgo(1));
    await processor.process(job());
    expect(followups.claimAndSend).not.toHaveBeenCalled();
    const [, delay] = queue.requeue.mock.calls[0];
    expect(delay).toBeGreaterThan(100_000); // ~2min restantes
    expect(delay).toBeLessThanOrEqual(120_000);
  });

  it('último envio do tenant já fora da janela de 3min → envia normalmente', async () => {
    followups.lastSentAtByTenant.mockResolvedValue(minutesAgo(5));
    await processor.process(job());
    expect(followups.claimAndSend).toHaveBeenCalledTimes(1);
  });

  // Erro real (uazapi fora do ar) precisa propagar pro BullMQ aplicar attempts/backoff.
  it('falha no envio propaga (deixa o BullMQ decidir o retry)', async () => {
    followups.claimAndSend.mockRejectedValue(new Error('uazapi 500'));
    await expect(processor.process(job())).rejects.toThrow('uazapi 500');
  });

  describe('marcação de falha definitiva', () => {
    it('não marca failed enquanto ainda há tentativas', async () => {
      await processor.onFailed(job('f1', { attemptsMade: 1, opts: { attempts: 3 } }));
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('marca failed só depois de esgotar as tentativas', async () => {
      await processor.onFailed(job('f1', { attemptsMade: 3, opts: { attempts: 3 } }));
      expect(repo.update).toHaveBeenCalledWith('f1', { status: 'failed' });
    });
  });
});
