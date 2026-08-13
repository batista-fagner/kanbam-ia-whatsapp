import { PaymentsService } from './payments.service';

// Testa só a máquina de estados do polling sob demanda (sem banco, sem Efí).
describe('PaymentsService — polling sob demanda', () => {
  let svc: any;
  let configRepo: any;
  let implantacaoRepo: any;
  let efiCalls: string[];

  const makeSvc = () => {
    configRepo = {
      find: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      save: jest.fn(),
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    implantacaoRepo = {
      find: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn(),
    };
    efiCalls = [];
    const config = { get: (k: string) => (k === 'EFI_CLIENT_ID' ? 'fake-id' : undefined) };
    const s = new PaymentsService(
      configRepo, implantacaoRepo, {} as any, {} as any,
      config as any, {} as any, {} as any,
    );
    (s as any)._efiGetCobStatus = jest.fn(async (txid: string) => { efiCalls.push(txid); return 'ATIVA'; });
    return s;
  };

  beforeEach(() => { svc = makeSvc(); });

  it('dorme por padrão: tick não toca no banco', async () => {
    await svc.pollPendingPix();
    // primeiro tick faz o deep check inicial (lastDeepCheckAt = 0)
    expect(configRepo.find).toHaveBeenCalledTimes(1);

    configRepo.find.mockClear();
    implantacaoRepo.find.mockClear();
    // ticks seguintes, ainda dormindo, não devem consultar nada
    for (let i = 0; i < 10; i++) await svc.pollPendingPix();
    expect(configRepo.find).not.toHaveBeenCalled();
    expect(implantacaoRepo.find).not.toHaveBeenCalled();
  });

  it('acorda ao gerar PIX e volta a consultar o banco', async () => {
    await svc.pollPendingPix();      // consome o deep check inicial
    configRepo.find.mockClear();

    await svc.pollPendingPix();
    expect(configRepo.find).not.toHaveBeenCalled(); // dormindo

    svc._wakePolling();              // simula geração de PIX
    await svc.pollPendingPix();
    expect(configRepo.find).toHaveBeenCalledTimes(1); // acordou
  });

  it('com cobrança pendente, segue polling todo tick e consulta a Efí', async () => {
    configRepo.find.mockResolvedValue([
      { id: 'tenant-1', lastPixTxid: 'txid-abc', planStatus: 'pending' },
    ]);
    svc._wakePolling();

    await svc.pollPendingPix();
    await svc.pollPendingPix();
    await svc.pollPendingPix();

    expect(configRepo.find).toHaveBeenCalledTimes(3);
    expect(efiCalls).toEqual(['txid-abc', 'txid-abc', 'txid-abc']);
    expect(svc._pollingActive).toBe(true);
  });

  it('quando o pendente some, volta a dormir sozinho', async () => {
    configRepo.find.mockResolvedValue([
      { id: 'tenant-1', lastPixTxid: 'txid-abc', planStatus: 'pending' },
    ]);
    svc._wakePolling();
    await svc.pollPendingPix();
    expect(svc._pollingActive).toBe(true);

    configRepo.find.mockResolvedValue([]); // pagou / expirou
    await svc.pollPendingPix();
    expect(svc._pollingActive).toBe(false);

    configRepo.find.mockClear();
    await svc.pollPendingPix();
    expect(configRepo.find).not.toHaveBeenCalled(); // dormindo de novo
  });

  it('deep check: revalida no banco a cada 30min mesmo dormindo', async () => {
    await svc.pollPendingPix();
    configRepo.find.mockClear();

    await svc.pollPendingPix();
    expect(configRepo.find).not.toHaveBeenCalled();

    // avança 30min
    svc._lastDeepCheckAt = Date.now() - 31 * 60 * 1000;
    await svc.pollPendingPix();
    expect(configRepo.find).toHaveBeenCalledTimes(1);
  });

  it('deep check reativa polling se outra instância criou a cobrança', async () => {
    await svc.pollPendingPix();
    expect(svc._pollingActive).toBe(false);

    configRepo.find.mockResolvedValue([
      { id: 'tenant-x', lastPixTxid: 'txid-outro', planStatus: 'pending' },
    ]);
    svc._lastDeepCheckAt = Date.now() - 31 * 60 * 1000;
    await svc.pollPendingPix();
    expect(svc._pollingActive).toBe(true);
    expect(efiCalls).toEqual(['txid-outro']);
  });

  it('boot: reativa polling se já havia pendência antes do restart', async () => {
    configRepo.count.mockResolvedValue(1);
    await svc.onModuleInit();
    expect(svc._pollingActive).toBe(true);
  });

  it('boot: segue dormindo se não há pendência', async () => {
    await svc.onModuleInit();
    expect(svc._pollingActive).toBe(false);
  });

  it('boot: banco fora do ar não derruba a aplicação', async () => {
    configRepo.count.mockRejectedValue(new Error('connection refused'));
    await expect(svc.onModuleInit()).resolves.toBeUndefined();
  });
});

// A Efí nunca marca uma cobrança como expirada sozinha (fica "ATIVA" pra sempre do lado dela) —
// a expiração de 6h precisa ser decidida localmente, com base em lastPixSentAt/createdAt.
describe('PaymentsService — expiração local de 6h (Efí não expira sozinha)', () => {
  let svc: any;
  let configRepo: any;
  let implantacaoRepo: any;

  const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000);

  const makeSvc = () => {
    configRepo = { find: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), save: jest.fn(), findOne: jest.fn() };
    implantacaoRepo = { find: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), update: jest.fn() };
    const config = { get: (k: string) => (k === 'EFI_CLIENT_ID' ? 'fake-id' : undefined) };
    const s = new PaymentsService(configRepo, implantacaoRepo, {} as any, {} as any, config as any, {} as any, {} as any);
    // Simula a Efí: cobrança sempre "ATIVA", nunca devolve EXPIRADA sozinha (comportamento real).
    (s as any)._efiGetCobStatus = jest.fn(async () => 'ATIVA');
    s._wakePolling();
    return s;
  };

  beforeEach(() => { svc = makeSvc(); });

  it('PIX gerado há menos de 6h continua pending, mesmo com Efí sempre "ATIVA"', async () => {
    const tenant = { id: 't1', lastPixTxid: 'txid-1', planStatus: 'pending', lastPixSentAt: hoursAgo(2) };
    configRepo.find.mockResolvedValue([tenant]);

    await svc.pollPendingPix();

    expect(configRepo.save).not.toHaveBeenCalled();
    expect(tenant.planStatus).toBe('pending');
  });

  it('PIX gerado há mais de 6h expira sozinho, mesmo a Efí dizendo "ATIVA"', async () => {
    const tenant = { id: 't2', lastPixTxid: 'txid-2', planStatus: 'pending', lastPixSentAt: hoursAgo(7) };
    configRepo.find.mockResolvedValue([tenant]);

    await svc.pollPendingPix();

    expect(configRepo.save).toHaveBeenCalledWith(expect.objectContaining({ id: 't2', planStatus: 'expired' }));
  });

  it('sem lastPixSentAt (nunca setado), não expira por engano', async () => {
    const tenant = { id: 't3', lastPixTxid: 'txid-3', planStatus: 'pending', lastPixSentAt: null };
    configRepo.find.mockResolvedValue([tenant]);

    await svc.pollPendingPix();

    expect(configRepo.save).not.toHaveBeenCalled();
  });

  it('implantação (usa createdAt) expira depois de 6h', async () => {
    const payment = { id: 'p1', status: 'pending', createdAt: hoursAgo(7) };
    implantacaoRepo.find.mockResolvedValue([payment]);

    await svc.pollPendingPix();

    expect(implantacaoRepo.update).toHaveBeenCalledWith('p1', { status: 'expired' });
  });

  it('implantação recente (< 6h) não expira', async () => {
    const payment = { id: 'p2', status: 'pending', createdAt: hoursAgo(1) };
    implantacaoRepo.find.mockResolvedValue([payment]);

    await svc.pollPendingPix();

    expect(implantacaoRepo.update).not.toHaveBeenCalled();
  });
});
