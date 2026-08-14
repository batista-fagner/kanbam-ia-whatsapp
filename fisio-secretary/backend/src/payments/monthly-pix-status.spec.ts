import { PaymentsService } from './payments.service';

// A página pública /pix/:txid decide o que mostrar só pelo planStatus (getPixPageData).
// Se um PIX novo é gerado mas o status fica 'expired', o cliente recebe o link e vê
// "Link expirado" com um QR perfeitamente válido no banco — bug real de produção
// (2026-08-14): o polling expira o PIX 6h depois do envio de D-2, e o reenvio de D-1
// gerava o PIX novo sem devolver o status pra 'pending'.
describe('PaymentsService — status acompanha o PIX mensal recém-gerado', () => {
  let svc: any;
  let configRepo: any;
  let saved: any[];

  const makeSvc = () => {
    saved = [];
    configRepo = {
      find: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      save: jest.fn(async (t: any) => { saved.push({ ...t }); return t; }),
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    const config = { get: () => undefined };
    const usersService = { findByTenant: jest.fn().mockResolvedValue([]) };
    const s = new PaymentsService(
      configRepo, {} as any, {} as any, {} as any,
      config as any, {} as any, usersService as any,
      { startCheckChain: jest.fn() } as any,
    );
    // Isola tudo que sai da máquina: Efí, WhatsApp, e-mail e auditoria.
    (s as any)._efiCreateCob = jest.fn().mockResolvedValue({ qrCode: 'data:image/png;base64,AAA', pixCode: '000201...' });
    (s as any)._logBillingEvent = jest.fn();
    (s as any)._sendMetaTemplate = jest.fn();
    (s as any)._sendPixEmail = jest.fn().mockResolvedValue({ ok: true });
    (s as any)._buildPixPageUrl = jest.fn().mockReturnValue('https://x/pix/y');
    return s;
  };

  const tenant = (planStatus: string) => ({
    id: 't1',
    billingPhone: '5511999999999',
    planValue: '390.00',
    planStatus,
    displayName: 'Cliente',
  }) as any;

  beforeEach(() => { svc = makeSvc(); });

  // O caso que quebrou em produção: reenvio no dia seguinte, com o PIX anterior já expirado.
  it('expired → pending: PIX novo não pode nascer escondido atrás de um status velho', async () => {
    const t = tenant('expired');
    await svc.generateAndSendMonthlyPix(t);
    expect(t.planStatus).toBe('pending');
    expect(t.lastPixTxid).toHaveLength(32);
    expect(t.lastPixQrCode).toBeTruthy();
  });

  it('active → pending: renovação normal entra no ciclo de cobrança', async () => {
    const t = tenant('active');
    await svc.generateAndSendMonthlyPix(t);
    expect(t.planStatus).toBe('pending');
  });

  // past_due é o estado de "venceu e não pagou" que o billing marca no dia D; voltar pra
  // 'pending' apagaria esse alerta do painel sem o cliente ter pago nada.
  it('past_due é preservado — reenviar cobrança não limpa o alerta de vencido', async () => {
    const t = tenant('past_due');
    await svc.generateAndSendMonthlyPix(t);
    expect(t.planStatus).toBe('past_due');
  });

  it('pending continua pending (nada a corrigir)', async () => {
    const t = tenant('pending');
    await svc.generateAndSendMonthlyPix(t);
    expect(t.planStatus).toBe('pending');
  });

  // Sem PIX gerado não há o que exibir: marcar 'pending' aqui só criaria uma cobrança
  // fantasma no painel e no polling.
  it('falha na Efí não mexe no status', async () => {
    const t = tenant('expired');
    (svc as any)._efiCreateCob = jest.fn().mockRejectedValue(new Error('Efí fora do ar'));
    await svc.generateAndSendMonthlyPix(t);
    expect(t.planStatus).toBe('expired');
    expect(configRepo.save).not.toHaveBeenCalled();
  });

  // O contador de 6h (usado por _isPixExpiredLocally) nasce junto do PIX, sempre.
  it('lastPixSentAt é reiniciado a cada geração', async () => {
    const t = tenant('expired');
    t.lastPixSentAt = new Date('2020-01-01');
    await svc.generateAndSendMonthlyPix(t);
    expect(new Date(t.lastPixSentAt).getFullYear()).toBeGreaterThan(2020);
  });
});
