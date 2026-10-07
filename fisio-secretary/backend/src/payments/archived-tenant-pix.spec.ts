import { PaymentsService } from './payments.service';

// Cliente arquivado não pode ter PIX consultado, ativado, expirado nem reenviado.
// O planStatus fica como estava (a tarja some só na UI), então tudo aqui precisa
// filtrar por archivedAt e nunca depender de mudar o status.
describe('PIX — cliente arquivado', () => {
  let svc: any;
  let configRepo: any;
  let efi: jest.Mock;
  let activate: jest.Mock;

  beforeEach(() => {
    configRepo = { findOne: jest.fn(), save: jest.fn(), find: jest.fn().mockResolvedValue([]), count: jest.fn() };
    const implantacaoRepo = { findOne: jest.fn(), update: jest.fn(), find: jest.fn().mockResolvedValue([]), count: jest.fn() };
    const config = { get: (k: string) => (k === 'EFI_CLIENT_ID' ? 'fake-id' : undefined) };
    svc = new PaymentsService(
      configRepo, implantacaoRepo as any, {} as any, {} as any,
      config as any, {} as any, {} as any, { startCheckChain: jest.fn() } as any,
    );
    efi = jest.fn(async () => 'CONCLUIDA');
    activate = jest.fn();
    svc._efiGetCobStatus = efi;
    svc._activatePaidTenant = activate;
  });

  it('cadeia da fila encerra sem consultar a Efí nem ativar, mesmo com PIX pago do outro lado', async () => {
    const tenant = { id: 't1', planStatus: 'expired', archivedAt: new Date(), lastPixSentAt: new Date(Date.now() - 9 * 3600e3) };
    configRepo.findOne.mockResolvedValue(tenant);
    expect(await svc.checkAndReconcileTenantPix('t1', 'tx')).toBe('confirmed');
    expect(efi).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
    expect(configRepo.save).not.toHaveBeenCalled();
    expect(tenant.planStatus).toBe('expired'); // não mexe no status
  });

  it('as varreduras de PIX pendente só pedem tenants com archivedAt nulo', async () => {
    await svc.listPendingPixTargets();
    await svc._hasPendingCharges();
    const wheres = [...configRepo.find.mock.calls, ...configRepo.count.mock.calls].map((c: any[]) => c[0].where);
    expect(wheres.length).toBeGreaterThan(0);
    for (const w of wheres) expect(w).toHaveProperty('archivedAt'); // IsNull()
  });

  it('reenvio manual de PIX é recusado', async () => {
    configRepo.findOne.mockResolvedValue({ id: 't1', paymentMethod: 'pix', billingPhone: '5511', archivedAt: new Date() });
    svc.generateAndSendMonthlyPix = jest.fn();
    await expect(svc.resendMonthlyPix('t1')).rejects.toThrow(/arquivado/);
    expect(svc.generateAndSendMonthlyPix).not.toHaveBeenCalled();
  });
});
