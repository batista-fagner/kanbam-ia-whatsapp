import { FollowupService } from './followup.service';
import { followupTriggers } from '../common/followup-triggers';
import { QUEUE_ENGINE_BULLMQ } from '../queue/queue.constants';
import { WhatsappConfigService } from '../evolution/whatsapp-config.service';

// Follow-up por evento (sem cron varrendo o banco). O que estes testes trancam:
//  - job velho (lead respondeu, mudou de raia, remarcou) sai sem enviar nada;
//  - fora do horário comercial o job é reagendado para a abertura, nunca descartado;
//  - as mesmas condições do cron legado (IA ligada, raia não usada, lembrete não enviado).
describe('Follow-up por evento (fila)', () => {
  const T = 'tenant-1';
  const RULE = { enabled: true, idleMinutes: 60, message: 'Oi {nome}!', activeSince: new Date(Date.now() - 24 * 3600_000).toISOString() };
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

  let cfg: any;
  let lead: any;
  let last: any;
  let svc: FollowupService;
  let leads: any;
  let configRepo: any;
  let followupRepo: any;
  let triggerQueue: any;
  let followupQueue: any;
  let appointments: any;
  let entry: any;

  beforeEach(() => {
    cfg = { id: T, archivedAt: null, autoFollowupEnabled: true, autoFollowupConfig: { novo_lead: RULE }, followupCadence: null, appointmentReminder: null };
    lead = { id: 'l1', tenantId: T, stage: 'novo_lead', phone: '5511999', name: 'Ana', autoFollowupSentStages: [], nurtureStep: 0, nextNurtureAt: null, nurturePaused: false, lastMessageDirection: 'outbound' };
    last = { id: 'm1', direction: 'outbound', createdAt: minutesAgo(61) };
    entry = { id: 'h1', enteredAt: new Date(Date.now() - 61 * 24 * 3600_000) };
    configRepo = { findOne: jest.fn(async () => cfg), find: jest.fn(async () => [cfg]) };
    followupRepo = { create: jest.fn((x) => x), save: jest.fn(async (x) => ({ id: 'f1', ...x })) };
    leads = {
      findOne: jest.fn(async () => lead),
      getLastMessageInfo: jest.fn(async () => last),
      getAiEnabled: jest.fn(async () => true),
      claimAutoFollowupStage: jest.fn(async () => true),
      claimCadenceStep: jest.fn(async () => true),
      update: jest.fn(async () => lead),
      findAutoFollowupCandidates: jest.fn(async () => []),
      findCadenceCandidates: jest.fn(async () => []),
      findPostSaleCandidates: jest.fn(async () => []),
      getStageEntry: jest.fn(async () => entry),
    };
    triggerQueue = { scheduleIdleCheck: jest.fn(async () => undefined), scheduleCadenceStep: jest.fn(async () => undefined), scheduleReminder: jest.fn(async () => undefined), schedulePostSale: jest.fn(async () => undefined) };
    followupQueue = { enqueue: jest.fn(async () => undefined) };
    appointments = { findById: jest.fn(), claimReminder: jest.fn(async () => true), findUpcomingForReminder: jest.fn(async () => []), professionalNameFor: jest.fn(async () => null) };
    const config = { get: (k: string) => (k === 'QUEUE_ENGINE' ? QUEUE_ENGINE_BULLMQ : '') } as any;
    svc = new FollowupService(followupRepo, configRepo, {} as any, leads, { emitLeadUpdated: jest.fn() } as any, {} as any, config, {} as any, appointments, followupQueue, triggerQueue);
    jest.spyOn(svc, 'isWithinBusinessHours').mockReturnValue(true);
  });

  afterEach(() => followupTriggers.setListener(null));

  const job = { tenantId: T, leadId: 'l1', stage: 'novo_lead', messageId: 'm1' };

  describe('runIdleCheck', () => {
    it('lead parado além do tempo → cria o follow-up e põe na fila de envio', async () => {
      await svc.runIdleCheck(job);
      expect(leads.claimAutoFollowupStage).toHaveBeenCalledWith('l1', 'novo_lead');
      expect(followupRepo.save).toHaveBeenCalledWith(expect.objectContaining({ message: 'Oi Ana!', status: 'pending' }));
      expect(followupQueue.enqueue).toHaveBeenCalled();
    });

    it('teve mensagem depois da âncora (lead respondeu) → não envia', async () => {
      last = { id: 'm2', direction: 'inbound', createdAt: minutesAgo(1) };
      await svc.runIdleCheck(job);
      expect(followupRepo.save).not.toHaveBeenCalled();
    });

    // Anti-bloqueio: ligar a regra não pode disparar para a base antiga inteira.
    it('lead parou ANTES de a raia ser ligada → nunca recebe', async () => {
      cfg.autoFollowupConfig.novo_lead = { ...RULE, activeSince: new Date().toISOString() };
      await svc.runIdleCheck(job);
      expect(followupRepo.save).not.toHaveBeenCalled();
    });

    it('regra sem activeSince (gravada direto no banco) → não dispara', async () => {
      const { activeSince, ...noSince } = RULE;
      cfg.autoFollowupConfig.novo_lead = noSince;
      await svc.runIdleCheck(job);
      expect(followupRepo.save).not.toHaveBeenCalled();
    });

    it('lead mudou de raia → não envia', async () => {
      lead.stage = 'lead_quente';
      await svc.runIdleCheck(job);
      expect(followupRepo.save).not.toHaveBeenCalled();
    });

    it('IA desligada na conversa → não envia', async () => {
      leads.getAiEnabled.mockResolvedValue(false);
      await svc.runIdleCheck(job);
      expect(followupRepo.save).not.toHaveBeenCalled();
    });

    it('raia já recebeu follow-up automático → não envia de novo', async () => {
      lead.autoFollowupSentStages = ['novo_lead'];
      await svc.runIdleCheck(job);
      expect(followupRepo.save).not.toHaveBeenCalled();
    });

    it('fora do horário comercial → reagenda para a abertura (com id novo)', async () => {
      (svc.isWithinBusinessHours as jest.Mock).mockReturnValue(false);
      const opens = new Date(Date.now() + 3 * 3600_000);
      jest.spyOn(svc, 'nextBusinessWindowStart').mockReturnValue(opens);
      await svc.runIdleCheck(job);
      expect(followupRepo.save).not.toHaveBeenCalled();
      expect(triggerQueue.scheduleIdleCheck).toHaveBeenCalledWith(job, opens, `w${opens.getTime()}`);
    });

    it('tempo de inatividade aumentou depois do agendamento → reagenda para o novo prazo', async () => {
      cfg.autoFollowupConfig.novo_lead = { ...RULE, idleMinutes: 120 };
      await svc.runIdleCheck(job);
      expect(followupRepo.save).not.toHaveBeenCalled();
      expect(triggerQueue.scheduleIdleCheck).toHaveBeenCalled();
    });
  });

  describe('gatilho de mensagem', () => {
    it('mensagem nossa → agenda o job para mensagem + tempo da raia', async () => {
      svc.onApplicationBootstrap();
      const at = new Date();
      followupTriggers.emit({ kind: 'message', tenantId: T, leadId: 'l1', messageId: 'm9', direction: 'outbound', at });
      await new Promise((r) => setImmediate(r));
      expect(triggerQueue.scheduleIdleCheck).toHaveBeenCalledWith(
        { tenantId: T, leadId: 'l1', stage: 'novo_lead', messageId: 'm9' },
        new Date(at.getTime() + 60 * 60_000),
      );
    });

    it('mensagem do lead → não agenda inatividade', async () => {
      svc.onApplicationBootstrap();
      followupTriggers.emit({ kind: 'message', tenantId: T, leadId: 'l1', messageId: 'm9', direction: 'inbound', at: new Date() });
      await new Promise((r) => setImmediate(r));
      expect(triggerQueue.scheduleIdleCheck).not.toHaveBeenCalled();
    });

    it('tenant sem regra nenhuma → nem lê o lead', async () => {
      cfg.autoFollowupConfig = null;
      svc.onApplicationBootstrap();
      followupTriggers.emit({ kind: 'message', tenantId: T, leadId: 'l1', messageId: 'm9', direction: 'outbound', at: new Date() });
      await new Promise((r) => setImmediate(r));
      expect(leads.findOne).not.toHaveBeenCalled();
    });

    // O emit roda dentro do saveMessage (caminho da resposta da IA): nunca pode lançar.
    it('falha ao agendar não propaga para quem emitiu', async () => {
      triggerQueue.scheduleIdleCheck.mockRejectedValue(new Error('redis fora'));
      svc.onApplicationBootstrap();
      expect(() => followupTriggers.emit({ kind: 'message', tenantId: T, leadId: 'l1', messageId: 'm9', direction: 'outbound', at: new Date() })).not.toThrow();
      await new Promise((r) => setImmediate(r));
    });
  });

  describe('runCadenceStep', () => {
    beforeEach(() => {
      cfg.followupCadence = { novo_lead: [{ offsetMinutes: 30, angle: 'a', fallbackMessage: 'Toque 1 {nome}' }, { offsetMinutes: 60, angle: 'b', fallbackMessage: 'Toque 2' }] };
      lead.nextNurtureAt = new Date(1792900000000);
    });

    it('âncora bate → envia o toque e arma o próximo', async () => {
      await svc.runCadenceStep({ tenantId: T, leadId: 'l1', anchor: 1792900000000 });
      expect(followupRepo.save).toHaveBeenCalledWith(expect.objectContaining({ message: 'Toque 1 Ana' }));
      expect(triggerQueue.scheduleCadenceStep).toHaveBeenCalledTimes(1); // próximo toque
    });

    it('lead respondeu (next_nurture_at mudou) → não envia', async () => {
      await svc.runCadenceStep({ tenantId: T, leadId: 'l1', anchor: 1792800000000 });
      expect(followupRepo.save).not.toHaveBeenCalled();
    });

    it('lead falou por último → espera a resposta da IA', async () => {
      lead.lastMessageDirection = 'inbound';
      await svc.runCadenceStep({ tenantId: T, leadId: 'l1', anchor: 1792900000000 });
      expect(followupRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('pós-venda (raia Vendas, X dias)', () => {
    const SALE = { enabled: true, days: 60, idleMinutes: 60 * 1440, message: 'Oi {nome}, hora da manutenção?', activeSince: new Date(Date.now() - 90 * 24 * 3600_000).toISOString() };
    const saleJob = { tenantId: T, leadId: 'l1', entryId: 'h1' };

    beforeEach(() => {
      cfg.autoFollowupConfig = { vendas: SALE };
      lead.stage = 'vendas';
    });

    it('entrou em Vendas há mais de 60 dias → envia (mesmo com a IA desligada)', async () => {
      leads.getAiEnabled.mockResolvedValue(false);
      await svc.runPostSale(saleJob);
      expect(leads.claimAutoFollowupStage).toHaveBeenCalledWith('l1', 'vendas');
      expect(followupRepo.save).toHaveBeenCalledWith(expect.objectContaining({ message: 'Oi Ana, hora da manutenção?' }));
    });

    it('saiu de Vendas → não envia', async () => {
      lead.stage = 'perdido';
      await svc.runPostSale(saleJob);
      expect(followupRepo.save).not.toHaveBeenCalled();
    });

    it('voltou pra Vendas depois (outra entrada) → o job da venda anterior não envia', async () => {
      entry = { id: 'h2', enteredAt: new Date() };
      await svc.runPostSale(saleJob);
      expect(followupRepo.save).not.toHaveBeenCalled();
    });

    it('vendeu antes de a regra ser ligada → nunca recebe', async () => {
      cfg.autoFollowupConfig.vendas = { ...SALE, activeSince: new Date().toISOString() };
      await svc.runPostSale(saleJob);
      expect(followupRepo.save).not.toHaveBeenCalled();
    });

    it('prazo ainda não venceu (dias aumentaram) → reagenda para entrada + dias', async () => {
      cfg.autoFollowupConfig.vendas = { ...SALE, days: 90 };
      await svc.runPostSale(saleJob);
      expect(followupRepo.save).not.toHaveBeenCalled();
      const [, days, at] = triggerQueue.schedulePostSale.mock.calls[0];
      expect(days).toBe(90);
      expect(at.getTime()).toBe(entry.enteredAt.getTime() + 90 * 24 * 3600_000);
    });

    it('lead entra em Vendas → agenda o lembrete para entrada + dias', async () => {
      entry = { id: 'h3', enteredAt: new Date() };
      svc.onApplicationBootstrap();
      followupTriggers.emit({ kind: 'stage', tenantId: T, leadId: 'l1' });
      await new Promise((r) => setImmediate(r));
      expect(triggerQueue.schedulePostSale).toHaveBeenCalledWith(
        { tenantId: T, leadId: 'l1', entryId: 'h3' }, 60, new Date(entry.enteredAt.getTime() + 60 * 24 * 3600_000),
      );
    });
  });

  describe('runAppointmentReminder', () => {
    const start = () => Date.now() + 23 * 3600_000;

    beforeEach(() => {
      cfg.appointmentReminder = { enabled: true, message: 'Lembrete {hora}', hoursBefore: 24 };
    });

    it('agendamento remarcado (horário diferente da âncora) → não envia', async () => {
      const s = start();
      appointments.findById.mockResolvedValue({ id: 'a1', tenantId: T, status: 'agendado', startDateTime: new Date(s + 3600_000), clientPhone: '55', reminderSentAt: null });
      await svc.runAppointmentReminder({ appointmentId: 'a1', startMs: s });
      expect(appointments.claimReminder).not.toHaveBeenCalled();
    });

    it('outra execução já marcou o lembrete → não envia de novo', async () => {
      const s = start();
      appointments.findById.mockResolvedValue({ id: 'a1', tenantId: T, status: 'agendado', startDateTime: new Date(s), clientPhone: '55', reminderSentAt: null });
      appointments.claimReminder.mockResolvedValue(false);
      const send = jest.spyOn(svc as any, 'sendAppointmentReminder');
      await svc.runAppointmentReminder({ appointmentId: 'a1', startMs: s });
      expect(send).not.toHaveBeenCalled();
    });
  });

  it('startOfNextDayBRT: 23h de Brasília → 00h do dia seguinte (03:00 UTC)', () => {
    expect(svc.startOfNextDayBRT(new Date('2026-10-27T02:00:00Z')).toISOString()).toBe('2026-10-27T03:00:00.000Z');
    expect(svc.startOfNextDayBRT(new Date('2026-10-26T15:00:00Z')).toISOString()).toBe('2026-10-27T03:00:00.000Z');
  });

  describe('nextBusinessWindowStart', () => {
    it('21h em Brasília → abre às 9h do dia seguinte', () => {
      (svc.isWithinBusinessHours as jest.Mock).mockRestore();
      const at = new Date('2026-10-27T00:00:00Z'); // 21:00 BRT de 26/10
      expect(svc.nextBusinessWindowStart('qualquer', at).toISOString()).toBe('2026-10-27T12:00:00.000Z');
    });

    it('dentro da janela → o próprio instante (arredondado a 15 min)', () => {
      (svc.isWithinBusinessHours as jest.Mock).mockRestore();
      const at = new Date('2026-10-26T15:00:00Z'); // 12:00 BRT
      expect(svc.nextBusinessWindowStart('qualquer', at).toISOString()).toBe('2026-10-26T15:00:00.000Z');
    });
  });
});

describe('Regras de Alertas — corte de ativação e limite diário', () => {
  const svc = new WhatsappConfigService({} as any, {} as any, {} as any) as any;
  const raw = (enabled: boolean) => ({ novo_lead: { enabled, idleMinutes: 60, message: 'oi', activeSince: '2020-01-01T00:00:00.000Z' } });

  it('ligar a raia carimba "agora" (ignora activeSince vindo do cliente)', () => {
    const before = Date.now();
    const out = svc.sanitizeAutoFollowup(raw(true), null);
    expect(Date.parse(out.novo_lead.activeSince)).toBeGreaterThanOrEqual(before);
  });

  it('salvar de novo com a raia já ligada mantém o corte original', () => {
    const prev = { novo_lead: { enabled: true, idleMinutes: 30, message: 'x', activeSince: '2026-10-26T12:00:00.000Z' } };
    expect(svc.sanitizeAutoFollowup(raw(true), prev).novo_lead.activeSince).toBe('2026-10-26T12:00:00.000Z');
  });

  it('desligar remove o corte (religar depois começa do zero)', () => {
    const prev = { novo_lead: { enabled: true, idleMinutes: 30, message: 'x', activeSince: '2026-10-26T12:00:00.000Z' } };
    expect(svc.sanitizeAutoFollowup(raw(false), prev).novo_lead.activeSince).toBeUndefined();
  });

  it('pós-venda: dias 1..730, guarda a unidade da tela e o corte de ativação', () => {
    const out = svc.sanitizeAutoFollowup({ vendas: { enabled: true, days: 60, unit: 'meses', message: 'oi' } }, null);
    expect(out.vendas.days).toBe(60);
    expect(out.vendas.unit).toBe('meses');
    expect(out.vendas.activeSince).toBeDefined();
    expect(svc.sanitizeAutoFollowup({ vendas: { enabled: true, days: 5000, message: 'oi' } }, null).vendas.days).toBe(730);
    expect(svc.sanitizeAutoFollowup({ vendas: { enabled: false, days: 0, message: '' } }, null).vendas.days).toBe(60);
  });

  it('limite diário: 1..100, inválido cai em 40', () => {
    expect(svc.sanitizeFollowupLimit(25)).toBe(25);
    expect(svc.sanitizeFollowupLimit(500)).toBe(100);
    expect(svc.sanitizeFollowupLimit(0)).toBe(40);
    expect(svc.sanitizeFollowupLimit('abc')).toBe(40);
  });
});
