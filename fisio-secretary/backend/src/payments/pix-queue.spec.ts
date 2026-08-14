import { PaymentsService } from './payments.service';
import { PixPollProcessor } from './pix-poll.processor';
import { JOB_CHECK_TENANT, JOB_CHECK_IMPLANTACAO, JOB_DEEP_RECONCILE } from '../queue/queue.constants';

// A cadeia de checagens substitui o sweep de 1min: cada cobrança tem seus próprios jobs,
// que se reagendam até a cobrança ser paga ou expirar. Aqui testamos as duas metades
// isoladas — a decisão (PaymentsService) e a continuidade da cadeia (processor).
describe('PIX por fila — reconciliação de uma cobrança', () => {
  let svc: any;
  let configRepo: any;
  let implantacaoRepo: any;

  const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000);

  const makeSvc = (efiStatus: string | null = 'ATIVA') => {
    configRepo = { findOne: jest.fn(), save: jest.fn(), find: jest.fn().mockResolvedValue([]), count: jest.fn() };
    implantacaoRepo = { findOne: jest.fn(), update: jest.fn(), find: jest.fn().mockResolvedValue([]), count: jest.fn() };
    const config = { get: (k: string) => (k === 'EFI_CLIENT_ID' ? 'fake-id' : undefined) };
    const s = new PaymentsService(
      configRepo, implantacaoRepo, {} as any, {} as any,
      config as any, {} as any, {} as any, { startCheckChain: jest.fn() } as any,
    );
    (s as any)._efiGetCobStatus = jest.fn(async () => efiStatus);
    (s as any)._activatePaidTenant = jest.fn();
    (s as any)._activatePaidImplantacao = jest.fn();
    return s;
  };

  it('cobrança ainda não paga e dentro das 6h → pending (cadeia continua)', async () => {
    svc = makeSvc('ATIVA');
    configRepo.findOne.mockResolvedValue({ id: 't1', planStatus: 'pending', lastPixSentAt: hoursAgo(1) });
    expect(await svc.checkAndReconcileTenantPix('t1', 'txid1')).toBe('pending');
    expect(svc._activatePaidTenant).not.toHaveBeenCalled();
  });

  it('Efí devolve CONCLUIDA → confirmed e ativa o tenant', async () => {
    svc = makeSvc('CONCLUIDA');
    configRepo.findOne.mockResolvedValue({ id: 't1', planStatus: 'pending', lastPixSentAt: hoursAgo(1) });
    expect(await svc.checkAndReconcileTenantPix('t1', 'txid1')).toBe('confirmed');
    expect(svc._activatePaidTenant).toHaveBeenCalledTimes(1);
  });

  // A Efí nunca marca a cobrança como expirada (fica "ATIVA" pra sempre do lado dela) —
  // as 6h são decididas aqui, e sempre contra o lastPixSentAt lido do banco AGORA.
  it('PIX com mais de 6h → expired, mesmo com a Efí dizendo ATIVA', async () => {
    svc = makeSvc('ATIVA');
    const tenant = { id: 't1', planStatus: 'pending', lastPixSentAt: hoursAgo(7) };
    configRepo.findOne.mockResolvedValue(tenant);
    expect(await svc.checkAndReconcileTenantPix('t1', 'txid1')).toBe('expired');
    expect(tenant.planStatus).toBe('expired');
  });

  // Cenário do reenvio diário (D-2, D-1, D): a cadeia velha continua viva, mas a expiração
  // é medida contra o PIX ATUAL. Sem isso, a cadeia de D-2 expiraria o PIX novo de D-1.
  it('cadeia antiga não expira um PIX novo — a janela vem do banco, não do job', async () => {
    svc = makeSvc('ATIVA');
    // lastPixSentAt recente (PIX regerado agora), embora esta cadeia seja de horas atrás.
    configRepo.findOne.mockResolvedValue({ id: 't1', planStatus: 'pending', lastPixSentAt: hoursAgo(0.5) });
    expect(await svc.checkAndReconcileTenantPix('t1', 'txid-antigo')).toBe('pending');
  });

  // Quem pagou já saiu de pending; a cadeia paralela só encerra sem tocar em nada.
  it('tenant já ativo → confirmed sem chamar a Efí', async () => {
    svc = makeSvc('ATIVA');
    configRepo.findOne.mockResolvedValue({ id: 't1', planStatus: 'active', lastPixSentAt: hoursAgo(1) });
    expect(await svc.checkAndReconcileTenantPix('t1', 'txid1')).toBe('confirmed');
    expect(svc._efiGetCobStatus).not.toHaveBeenCalled();
  });

  it('implantação paga → confirmed e ativa o pagamento', async () => {
    svc = makeSvc('CONCLUIDA');
    implantacaoRepo.findOne.mockResolvedValue({ id: 'p1', status: 'pending', createdAt: hoursAgo(1) });
    expect(await svc.checkAndReconcileImplantacaoPix('p1', 'txid1')).toBe('confirmed');
    expect(svc._activatePaidImplantacao).toHaveBeenCalledTimes(1);
  });

  it('implantação com mais de 6h → expired', async () => {
    svc = makeSvc('ATIVA');
    implantacaoRepo.findOne.mockResolvedValue({ id: 'p1', status: 'pending', createdAt: hoursAgo(7) });
    expect(await svc.checkAndReconcileImplantacaoPix('p1', 'txid1')).toBe('expired');
    expect(implantacaoRepo.update).toHaveBeenCalledWith('p1', { status: 'expired' });
  });
});

describe('PixPollProcessor — continuidade da cadeia', () => {
  let payments: any;
  let pixQueue: any;
  let processor: PixPollProcessor;

  const job = (name: string, data: any = {}) => ({ name, data }) as any;

  beforeEach(() => {
    payments = {
      checkAndReconcileTenantPix: jest.fn(),
      checkAndReconcileImplantacaoPix: jest.fn(),
      listPendingPixTargets: jest.fn().mockResolvedValue({ tenants: [], implantacoes: [] }),
    };
    pixQueue = { startCheckChain: jest.fn(), scheduleNextCheck: jest.fn() };
    processor = new PixPollProcessor(payments, pixQueue);
  });

  it('pending → agenda o próximo elo com a tentativa incrementada', async () => {
    payments.checkAndReconcileTenantPix.mockResolvedValue('pending');
    await processor.process(job(JOB_CHECK_TENANT, { id: 't1', txid: 'x', attempt: 2 }));
    expect(pixQueue.scheduleNextCheck).toHaveBeenCalledWith('tenant', 't1', 'x', 3);
  });

  it('confirmed → cadeia encerrada, nada reagendado', async () => {
    payments.checkAndReconcileTenantPix.mockResolvedValue('confirmed');
    await processor.process(job(JOB_CHECK_TENANT, { id: 't1', txid: 'x', attempt: 0 }));
    expect(pixQueue.scheduleNextCheck).not.toHaveBeenCalled();
  });

  it('expired → cadeia encerrada, nada reagendado', async () => {
    payments.checkAndReconcileTenantPix.mockResolvedValue('expired');
    await processor.process(job(JOB_CHECK_TENANT, { id: 't1', txid: 'x', attempt: 0 }));
    expect(pixQueue.scheduleNextCheck).not.toHaveBeenCalled();
  });

  // Efí fora do ar não pode encerrar a cobrança nem derrubar o worker — só adiar.
  it('erro na Efí é tratado como pending (cadeia sobrevive)', async () => {
    payments.checkAndReconcileTenantPix.mockRejectedValue(new Error('timeout'));
    await processor.process(job(JOB_CHECK_TENANT, { id: 't1', txid: 'x', attempt: 0 }));
    expect(pixQueue.scheduleNextCheck).toHaveBeenCalledWith('tenant', 't1', 'x', 1);
  });

  it('job de implantação usa o caminho de implantação', async () => {
    payments.checkAndReconcileImplantacaoPix.mockResolvedValue('pending');
    await processor.process(job(JOB_CHECK_IMPLANTACAO, { id: 'p1', txid: 'x', attempt: 0 }));
    expect(payments.checkAndReconcileTenantPix).not.toHaveBeenCalled();
    expect(pixQueue.scheduleNextCheck).toHaveBeenCalledWith('implantacao', 'p1', 'x', 1);
  });

  // A reconciliação periódica reabre cadeias; jobId estável faz o BullMQ ignorar as que já existem.
  it('deep reconcile reenfileira cada pendência encontrada', async () => {
    payments.listPendingPixTargets.mockResolvedValue({
      tenants: [{ id: 't1', txid: 'a' }, { id: 't2', txid: 'b' }],
      implantacoes: [{ id: 'p1', txid: 'c' }],
    });
    await processor.process(job(JOB_DEEP_RECONCILE));
    expect(pixQueue.startCheckChain).toHaveBeenCalledTimes(3);
    expect(pixQueue.startCheckChain).toHaveBeenCalledWith('tenant', 't1', 'a');
    expect(pixQueue.startCheckChain).toHaveBeenCalledWith('implantacao', 'p1', 'c');
  });
});
