import { samePhone, splitBrazilPhone, TrinksClient, TrinksUnavailableError } from './trinks.client';
import { pickTrinksProfessional, TrinksAgendaBackend, unionSlots } from './trinks-agenda.backend';
import { buildTrinksAgendaRules, claimsDone, describeWhen, replyMatchesWhen, TrinksAiFlow } from './trinks-ai.flow';
import { AgendaConflictError } from '../agenda.service';
import { toSPDate } from '../../common/utils/sp-time.util';

// 11/01/2030 é uma sexta-feira — longe o bastante pra nunca ser "passado" no teste.
const FRI = '2030-01-11';

const svcFita: any = { id: 'svc-fita', name: 'Fita adesiva', durationMinutes: 120, externalId: '16006434', externalDurationMinutes: 120, price: '450.00' };
const parts: any = { rules: '', jsonFields: '', dynamic: '', codes: { S1: 'svc-fita' }, backend: 'trinks' };

function fakeRes(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, text: async () => (body === undefined ? '' : JSON.stringify(body)) };
}

describe('Trinks — utilitários', () => {
  it('junta horários de quem faz o serviço, sem passado e em ordem', () => {
    const earliest = toSPDate(FRI, '10:00');
    const day = unionSlots(FRI, [
      { id: 1, horariosVagos: ['09:00', '10:00', '13:00'] },
      { id: 2, horariosVagos: ['10:00', '11:30'] },
      { id: 3, horariosVagos: ['08:00', '12:00'] }, // não faz o serviço
    ], new Set([1, 2]), earliest);
    expect(day.weekday).toBe('sex');
    expect(day.slots.map((s) => s.time)).toEqual(['10:00', '11:30', '13:00']);
    expect(day.slots[0].professionalIds).toEqual([1, 2]);
  });

  it('escolhe o profissional com mais horários vagos (menos ocupado)', () => {
    expect(pickTrinksProfessional([1, 2], { 1: 3, 2: 9 }, [1, 2])).toBe(2);
    expect(pickTrinksProfessional([1, 2], { 1: 5, 2: 5 }, [2, 1])).toBe(2); // empate → ordem
  });

  it('telefone: separa DDD, põe o 9 e compara ignorando DDI e 9 extra', () => {
    expect(splitBrazilPhone('558499998888')).toEqual({ ddd: '84', numero: '999998888' });
    expect(splitBrazilPhone('5584999998888')).toEqual({ ddd: '84', numero: '999998888' });
    expect(splitBrazilPhone('123')).toBeNull();
    const target = splitBrazilPhone('558499998888')!;
    expect(samePhone({ ddd: '84', telefone: '999998888' }, target)).toBe(true);
    expect(samePhone({ ddd: '84', telefone: '99998888' }, target)).toBe(true);
    expect(samePhone({ ddd: '83', telefone: '999998888' }, target)).toBe(false);
    expect(samePhone({ ddd: '', telefone: '84999998888' }, target)).toBe(true);
  });

  it('data por extenso calculada pelo sistema', () => {
    expect(describeWhen(toSPDate(FRI, '13:00'))).toBe('sexta-feira, 11/01 às 13:00');
  });

  it('confere se a resposta da IA fala do mesmo dia/horário', () => {
    const start = toSPDate(FRI, '13:00');
    expect(replyMatchesWhen('Perfeito! Sexta 11/01 às 13h te espero 💜', start)).toEqual({ consistent: true, mentionsTime: true });
    expect(replyMatchesWhen('Combinado, sábado às 13:00', start).consistent).toBe(false);
    expect(replyMatchesWhen('Combinado, sexta 12/01 às 13:00', start).consistent).toBe(false);
    expect(replyMatchesWhen('Combinado, sexta às 14h', start).consistent).toBe(false);
    expect(replyMatchesWhen('Tem sinal de R$ 50 pra reservar', start)).toEqual({ consistent: true, mentionsTime: false });
  });

  it('percebe quando a IA diz que já fez', () => {
    expect(claimsDone('Prontinho, agendado!')).toBe(true);
    expect(claimsDone('Seu horário está confirmado')).toBe(true);
    expect(claimsDone('Combinado! Agendei a sua manutenção para sexta')).toBe(true);
    expect(claimsDone('Pronto, cancelei seu horário')).toBe(true);
    expect(claimsDone('Qual horário fica melhor?')).toBe(false);
  });

  it('regras da agenda Trinks: sem preço e só serviços liberados', () => {
    const { rules, codes } = buildTrinksAgendaRules([svcFita]);
    expect(codes).toEqual({ S1: 'svc-fita' });
    expect(rules).toContain('S1 — Fita adesiva — 2h');
    expect(rules).not.toContain('R$');
    expect(rules).toContain('tabela de preços deste prompt');
    expect(buildTrinksAgendaRules([]).rules).toContain('nenhum serviço liberado');
  });
});

describe('Trinks — cliente HTTP', () => {
  it('manda chave e estabelecimento, sem repetir escrita', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(fakeRes(500, {}));
    const c = new TrinksClient({ apiKey: 'k', establishmentId: '118814' }, { fetchImpl, retryDelayMs: 0 });
    await expect(c.createAppointment({ clienteId: 1, servicoId: 2, profissionalId: 3, dataHoraInicio: `${FRI}T13:00:00`, duracaoEmMinutos: 60, valor: 0, confirmado: false })).rejects.toBeInstanceOf(TrinksUnavailableError);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // POST nunca é repetido
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers['X-Api-Key']).toBe('k');
    expect(init.headers.estabelecimentoId).toBe('118814');
    expect(JSON.parse(init.body)).toMatchObject({ confirmado: false, dataHoraInicio: `${FRI}T13:00:00` });
  });

  it('leitura com erro 500 tenta de novo; 429 para na hora', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(fakeRes(500, {}))
      .mockResolvedValueOnce(fakeRes(200, { data: [{ id: 1, nome: 'Ana', horariosVagos: ['09:00'] }] }));
    const c = new TrinksClient({ apiKey: 'k', establishmentId: '1' }, { fetchImpl, retryDelayMs: 0 });
    expect(await c.availability(FRI, 9)).toEqual([{ id: 1, nome: 'Ana', horariosVagos: ['09:00'] }]);
    const rate = new TrinksClient({ apiKey: 'k', establishmentId: '1' }, { fetchImpl: jest.fn().mockResolvedValue(fakeRes(429, {})), retryDelayMs: 0, rateLimitRetries: 0 });
    await expect(rate.availability(FRI, 9)).rejects.toMatchObject({ reason: 'rate_limit' });
  });

  it('429 em leitura: espera e tenta de novo; 429 em escrita: não repete', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce({ ...fakeRes(429, {}), headers: { get: () => '0.01' } })
      .mockResolvedValueOnce(fakeRes(200, { data: [] }));
    const c = new TrinksClient({ apiKey: 'k', establishmentId: '1' }, { fetchImpl, retryDelayMs: 0, rateLimitRetries: 1 });
    expect(await c.availability(FRI, 9)).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const post = jest.fn().mockResolvedValue({ ...fakeRes(429, {}), headers: { get: () => '0.01' } });
    const w = new TrinksClient({ apiKey: 'k', establishmentId: '1' }, { fetchImpl: post, retryDelayMs: 0, rateLimitRetries: 3 });
    await expect(w.cancelAppointment(1, 'x')).rejects.toMatchObject({ reason: 'rate_limit' });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('cota estourada barra antes de chamar a Trinks', async () => {
    const fetchImpl = jest.fn();
    const c = new TrinksClient({ apiKey: 'k', establishmentId: '1' }, { fetchImpl, beforeCall: async () => { throw new TrinksUnavailableError('quota', 'cota'); } });
    await expect(c.availability(FRI, 9)).rejects.toMatchObject({ reason: 'quota' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

// ───────── Backend (grava/remarca/cancela) ─────────

function backendWith(client: any, opts: { autoConfirm?: boolean } = {}) {
  const catalog = {
    services: [{ id: 16006434, nome: 'Aplicação de fita adesiva', duracaoEmMinutos: 120, preco: 100 }],
    professionals: [{ id: 1, nome: 'Ana', apelido: null, serviceIds: [16006434] }, { id: 2, nome: 'Bia', apelido: null, serviceIds: [16006434] }, { id: 3, nome: 'Cris', apelido: null, serviceIds: [] }],
  };
  const integration: any = { clientFor: jest.fn().mockResolvedValue({ client, integration: { catalog, autoConfirm: !!opts.autoConfirm } }) };
  const saved: any[] = [];
  const apptRepo: any = {
    findOne: jest.fn().mockResolvedValue(null),
    create: (x: any) => x,
    save: jest.fn(async (x: any) => { const r = { id: `appt-${saved.length + 1}`, ...x }; saved.push(r); return r; }),
    update: jest.fn(),
  };
  const scheduleRepo: any = { findOne: jest.fn().mockResolvedValue({ minNoticeHours: 0, bookingWindowDays: 3650 }) };
  const dataSource: any = { query: jest.fn().mockResolvedValue([{ content: 'pode ser sim' }]) };
  return { backend: new TrinksAgendaBackend(integration, apptRepo, {} as any, scheduleRepo, dataSource), saved, apptRepo };
}

describe('Trinks — gravar na agenda', () => {
  const lead: any = { id: 'lead-1', name: 'Maria', phone: '558499998888' };

  it('reconsulta, escolhe quem está livre, acha/cria a cliente e grava "não confirmado"', async () => {
    const client: any = {
      availability: jest.fn().mockResolvedValue([
        { id: 1, nome: 'Ana', horariosVagos: ['13:00'] },
        { id: 2, nome: 'Bia', horariosVagos: ['09:00', '13:00', '15:00'] },
        { id: 3, nome: 'Cris', horariosVagos: ['13:00', '14:00', '15:00', '16:00'] },
      ]),
      searchClientsByPhone: jest.fn().mockResolvedValue([{ id: 77, nome: 'Outra', telefones: [{ ddd: '11', telefone: '999998888' }] }]),
      createClient: jest.fn().mockResolvedValue(555),
      createAppointment: jest.fn().mockResolvedValue(9001),
    };
    const { backend, saved } = backendWith(client);
    const appt = await backend.book({ tenantId: 't1', service: svcFita, start: toSPDate(FRI, '13:00'), lead, clientName: 'Maria' });
    expect(client.createClient).toHaveBeenCalledWith({ nome: 'Maria', ddd: '84', numero: '999998888' }); // DDD 11 não é ela
    const body = client.createAppointment.mock.calls[0][0];
    expect(body).toMatchObject({ clienteId: 555, servicoId: 16006434, profissionalId: 2, dataHoraInicio: `${FRI}T13:00:00`, duracaoEmMinutos: 120, valor: 100, confirmado: false });
    expect(body.observacoes).toContain('Agendado pela IA');
    expect(body.observacoes).toContain('pode ser sim');
    expect(appt).toMatchObject({ externalProvider: 'trinks', externalId: '9001', externalProfessionalName: 'Bia', status: 'agendado', source: 'ia', serviceId: 'svc-fita' });
    expect(saved).toHaveLength(1);
  });

  it('vaga sumiu na hora de gravar → conflito com alternativas, nada gravado', async () => {
    const client: any = {
      availability: jest.fn().mockResolvedValue([{ id: 1, nome: 'Ana', horariosVagos: ['14:00', '15:00'] }]),
      createAppointment: jest.fn(),
    };
    const { backend } = backendWith(client);
    await expect(backend.book({ tenantId: 't1', service: svcFita, start: toSPDate(FRI, '13:00'), lead, clientName: 'Maria' })).rejects.toBeInstanceOf(AgendaConflictError);
    expect(client.createAppointment).not.toHaveBeenCalled();
  });

  it('remarcar manda TODOS os campos (a Trinks substitui o agendamento inteiro)', async () => {
    const client: any = {
      getAppointment: jest.fn().mockResolvedValue({ id: 9001, status: { id: 3 }, cliente: { id: 555 }, servico: { id: 16006434 }, profissional: { id: 2 }, dataHoraInicio: `${FRI}T13:00:00`, duracaoEmMinutos: 120, valor: 100, observacoesDoEstabelecimento: 'Agendado pela IA' }),
      availability: jest.fn().mockResolvedValue([{ id: 1, nome: 'Ana', horariosVagos: ['16:00'] }]),
      updateAppointment: jest.fn().mockResolvedValue(undefined),
    };
    const { backend } = backendWith(client);
    const mirror: any = { id: 'appt-1', externalId: '9001', externalClientId: '555', service: 'Fita adesiva', serviceId: 'svc-fita', value: 100, startDateTime: toSPDate(FRI, '13:00') };
    await backend.reschedule('t1', mirror, toSPDate(FRI, '16:00'), svcFita);
    const [id, body] = client.updateAppointment.mock.calls[0];
    expect(id).toBe('9001');
    expect(body).toMatchObject({ clienteId: 555, servicoId: 16006434, profissionalId: 1, dataHoraInicio: `${FRI}T16:00:00`, duracaoEmMinutos: 120, valor: 100 });
    expect(body.observacoes).toContain('Agendado pela IA');
    expect(body.observacoes).toContain('Remarcado pela IA');
  });
});

// ───────── Fluxo da IA ─────────

function flowWith(backend: any, opts: { services?: any[] } = {}) {
  const integration: any = { approvedServices: jest.fn().mockResolvedValue(opts.services ?? [svcFita]), recordError: jest.fn() };
  const salon: any = { notifySalon: jest.fn().mockResolvedValue(undefined) };
  const leadRepo: any = { update: jest.fn() };
  return { flow: new TrinksAiFlow(backend, integration, salon, leadRepo), salon, leadRepo, integration };
}

function freshState(extra: any = {}) {
  return { serviceId: 'svc-fita', date: FRI, checkedAt: new Date().toISOString(), days: [{ date: FRI, weekday: 'sex', times: ['13:00', '15:00'] }], unavailable: false, pending: null, ...extra };
}

describe('Trinks — fluxo da IA', () => {
  it('prepare: fora da Trinks → undefined; IA desligada → null; ligada → partes sem preço', async () => {
    const backend: any = { schedule: jest.fn(), currentMirror: jest.fn().mockResolvedValue(null) };
    const { flow } = flowWith(backend);
    backend.schedule.mockResolvedValueOnce({ mode: 'professionals', enabled: true });
    expect(await flow.prepare('t1', { id: 'l' } as any)).toBeUndefined();
    backend.schedule.mockResolvedValueOnce({ mode: 'trinks', enabled: false });
    expect(await flow.prepare('t1', { id: 'l' } as any)).toBeNull();
    backend.schedule.mockResolvedValueOnce({ mode: 'trinks', enabled: true });
    const p = await flow.prepare('t1', { id: 'l', agendaState: null } as any);
    expect(p?.backend).toBe('trinks');
    expect(p?.rules).not.toContain('R$');
    expect(p?.dynamic).toContain('ainda não consultados');
  });

  it('1º schedule NÃO grava: manda resumo com dia calculado pelo sistema', async () => {
    const backend: any = { book: jest.fn(), fetchDays: jest.fn() };
    const { flow, leadRepo } = flowWith(backend);
    const lead: any = { id: 'lead-1', name: 'Maria', phone: '558499998888', agendaState: freshState() };
    const ai: any = { action: 'schedule', agendaServiceCode: 'S1', appointmentDateTime: `${FRI}T13:00:00`, reply: 'Agendado pra sábado às 13h!', stage: 'agendado' };
    await flow.applyAction('t1', lead, ai, parts);
    expect(backend.book).not.toHaveBeenCalled();
    expect(backend.fetchDays).not.toHaveBeenCalled(); // horário estava na lista consultada
    expect(ai.reply).toBe('Só confirmando: *Fita adesiva* na *sexta-feira, 11/01 às 13:00*. Posso confirmar o agendamento? 😊');
    expect(ai.action).toBe('none');
    expect(ai.stage).toBe('lead_quente');
    expect(lead.agendaState.pending).toMatchObject({ kind: 'schedule', serviceId: 'svc-fita', start: toSPDate(FRI, '13:00').toISOString() });
    expect(leadRepo.update).toHaveBeenCalled();
  });

  it('mantém o aviso de sinal da IA junto do resumo', async () => {
    const { flow } = flowWith({ book: jest.fn() });
    const lead: any = { id: 'lead-1', phone: '558499998888', agendaState: freshState() };
    const ai: any = { action: 'schedule', agendaServiceCode: 'S1', appointmentDateTime: `${FRI}T13:00:00`, reply: 'Pra reservar tem sinal de R$ 50 😊', stage: 'lead_quente' };
    await flow.applyAction('t1', lead, ai, parts);
    expect(ai.reply.startsWith('Pra reservar tem sinal de R$ 50 😊\n\nSó confirmando:')).toBe(true);
  });

  it('com o "sim" (mesmos dados): grava na Trinks e só então diz agendado', async () => {
    const start = toSPDate(FRI, '13:00');
    const backend: any = { book: jest.fn().mockResolvedValue({ id: 'appt-1', startDateTime: start }) };
    const { flow, leadRepo } = flowWith(backend);
    const lead: any = { id: 'lead-1', name: 'Maria', phone: '558499998888', agendaState: freshState({ pending: { kind: 'schedule', serviceId: 'svc-fita', start: start.toISOString(), appointmentId: null, createdAt: new Date().toISOString() } }) };
    const ai: any = { action: 'schedule', agendaServiceCode: 'S1', appointmentDateTime: `${FRI}T13:00:00`, reply: 'Agendado para sábado!', stage: 'agendado' };
    await flow.applyAction('t1', lead, ai, parts);
    expect(backend.book).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', start, service: svcFita }));
    expect(ai.stage).toBe('agendado');
    expect(ai.reply).toBe('Prontinho, agendado! ✅ *Fita adesiva* — *sexta-feira, 11/01 às 13:00*.'); // "sábado" da IA descartado
    expect(lead.agendaState.pending).toBeNull();
    expect(leadRepo.update).toHaveBeenCalledWith('lead-1', { appointmentAt: start });
  });

  it('IA diz "agendado" sem a action enquanto espera o sim → reenvia o resumo', async () => {
    const start = toSPDate(FRI, '13:00');
    const { flow } = flowWith({});
    const lead: any = { id: 'lead-1', agendaState: freshState({ pending: { kind: 'schedule', serviceId: 'svc-fita', start: start.toISOString(), appointmentId: null, createdAt: new Date().toISOString() } }) };
    const ai: any = { action: 'none', reply: 'Prontinho, agendado!', stage: 'agendado' };
    await flow.applyAction('t1', lead, ai, parts);
    expect(ai.reply).toContain('Posso confirmar o agendamento?');
    expect(ai.stage).toBe('lead_quente');
  });

  it('horário fora da lista: consulta a Trinks ao vivo; sem vaga → alternativas', async () => {
    const backend: any = { book: jest.fn(), fetchDays: jest.fn().mockResolvedValue([{ date: FRI, weekday: 'sex', slots: [{ time: '15:00' }] }]) };
    const { flow } = flowWith(backend);
    const lead: any = { id: 'lead-1', phone: '558499998888', agendaState: freshState() };
    const ai: any = { action: 'schedule', agendaServiceCode: 'S1', appointmentDateTime: `${FRI}T10:00:00`, reply: 'ok', stage: 'lead_quente' };
    await flow.applyAction('t1', lead, ai, parts);
    expect(backend.fetchDays).toHaveBeenCalledWith('t1', svcFita, FRI, { live: true });
    expect(ai.reply).toContain('11/01 às 15:00');
    expect(backend.book).not.toHaveBeenCalled();
  });

  it('Trinks fora do ar na hora de gravar → "equipe confirma" + aviso ao salão', async () => {
    const start = toSPDate(FRI, '13:00');
    const backend: any = { book: jest.fn().mockRejectedValue(new TrinksUnavailableError('down', 'Trinks fora do ar (HTTP 503)')) };
    const { flow, salon } = flowWith(backend);
    const lead: any = { id: 'lead-x', name: 'Maria', phone: '558499998888', agendaState: freshState({ pending: { kind: 'schedule', serviceId: 'svc-fita', start: start.toISOString(), appointmentId: null, createdAt: new Date().toISOString() } }) };
    const ai: any = { action: 'schedule', agendaServiceCode: 'S1', appointmentDateTime: `${FRI}T13:00:00`, reply: 'Agendado!', stage: 'agendado' };
    await flow.applyAction('t1', lead, ai, parts);
    expect(ai.reply).toContain('Vou pedir pra equipe confirmar');
    expect(ai.action).toBe('none');
    expect(ai.stage).toBe('lead_quente');
    expect(salon.notifySalon).toHaveBeenCalledWith('t1', expect.stringContaining('não conseguiu agendar'));
  });

  it('cancelar também pede confirmação antes', async () => {
    const appt: any = { id: 'appt-1', service: 'Fita adesiva', serviceId: 'svc-fita', startDateTime: toSPDate(FRI, '13:00') };
    const backend: any = { resolveActive: jest.fn().mockResolvedValue(appt), cancel: jest.fn().mockResolvedValue(appt) };
    const { flow } = flowWith(backend);
    const lead: any = { id: 'lead-1', agendaState: null };
    const ai: any = { action: 'cancel', reply: 'Cancelado!', stage: 'lead_quente' };
    await flow.applyAction('t1', lead, ai, parts);
    expect(backend.cancel).not.toHaveBeenCalled();
    expect(ai.reply).toContain('você quer cancelar o agendamento de *Fita adesiva* na *sexta-feira, 11/01 às 13:00*');
    const ai2: any = { action: 'cancel', reply: 'ok', stage: 'lead_quente' };
    await flow.applyAction('t1', lead, ai2, parts);
    expect(backend.cancel).toHaveBeenCalledWith('t1', appt);
    expect(ai2.reply).toContain('Prontinho, cancelei');
  });

  it('consulta que falha vira "agenda indisponível" + aviso, sem inventar horário', async () => {
    const backend: any = { fetchDays: jest.fn().mockRejectedValue(new TrinksUnavailableError('quota', 'cota')), currentMirror: jest.fn().mockResolvedValue(null), schedule: jest.fn().mockResolvedValue({ mode: 'trinks', enabled: true }) };
    const { flow, salon } = flowWith(backend);
    const lead: any = { id: 'lead-q', name: 'Maria', phone: '558499998888', agendaState: null };
    expect(await flow.registerCheck('t1', lead, { agendaServiceCode: 'S1', agendaDate: FRI } as any, parts)).toBe(true);
    expect(lead.agendaState.unavailable).toBe(true);
    expect(salon.notifySalon).toHaveBeenCalled();
    const p = await flow.prepare('t1', lead, true);
    expect(p?.dynamic).toContain('AGENDA INDISPONÍVEL');
    expect(await flow.fallbackReply(lead)).toContain('equipe');
  });
});
