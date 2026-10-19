import { AgendaAiService, buildAgendaRules, parseLocal, normalizeDate } from './agenda-ai.service';
import { AgendaConflictError } from './agenda.service';
import { buildAgendaMessage } from './agenda-notifier';

const services: any[] = [
  { id: 'svc-fita', name: 'Fita adesiva', durationMinutes: 120, price: '350.00', priceNote: null },
  { id: 'svc-queratina', name: 'Queratina', durationMinutes: 90, price: null, priceNote: 'R$ 4 por grama' },
];
const parts = { rules: '', jsonFields: '', dynamic: '', codes: { S1: 'svc-fita', S2: 'svc-queratina' } };
const lead: any = { id: 'lead-1', name: 'Maria', phone: '5584999990000', agendaState: null };

function build(agenda: any) {
  const leadRepo: any = { update: jest.fn() };
  return { svc: new AgendaAiService(agenda, leadRepo), leadRepo };
}

describe('agenda-ai', () => {
  it('monta a lista de serviços com código, duração e preço/observação', () => {
    const { rules, codes } = buildAgendaRules(services);
    expect(codes).toEqual({ S1: 'svc-fita', S2: 'svc-queratina' });
    expect(rules).toContain('S1 — Fita adesiva — 2h — R$ 350,00');
    expect(rules).toContain('S2 — Queratina — 1h30 — R$ 4 por grama');
    expect(rules).not.toMatch(/profissional:/i);
  });

  it('lê data/hora local de Brasília', () => {
    expect(parseLocal('2026-10-23T14:00:00')!.toISOString()).toBe('2026-10-23T17:00:00.000Z');
    expect(parseLocal('amanhã')).toBeNull();
    expect(normalizeDate('2026-10-23T10:00')).toBe('2026-10-23');
  });

  it('schedule: agenda de verdade e só então marca stage agendado', async () => {
    const agenda: any = { nextActiveForLead: jest.fn().mockResolvedValue(null), book: jest.fn().mockResolvedValue({ id: 'a1', startDateTime: new Date('2026-10-23T17:00:00Z') }) };
    const { svc, leadRepo } = build(agenda);
    const ai: any = { action: 'schedule', agendaServiceCode: 's1', appointmentDateTime: '2026-10-23T14:00:00', reply: 'Agendado!', stage: 'lead_quente' };
    await svc.applyAction('t1', lead, ai, parts);
    expect(agenda.book).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', serviceId: 'svc-fita', source: 'ia', leadId: 'lead-1' }));
    expect(ai.stage).toBe('agendado');
    expect(ai.reply).toBe('Agendado!');
    expect(leadRepo.update).toHaveBeenCalled();
  });

  it('schedule com conflito: troca o reply por alternativas reais e não diz agendado', async () => {
    const agenda: any = {
      nextActiveForLead: jest.fn().mockResolvedValue(null),
      book: jest.fn().mockRejectedValue(new AgendaConflictError('ocupado', [{ date: '2026-10-23', time: '16:00' }])),
    };
    const { svc } = build(agenda);
    const ai: any = { action: 'schedule', agendaServiceCode: 'S1', appointmentDateTime: '2026-10-23T14:00:00', reply: 'Agendado!', stage: 'agendado' };
    await svc.applyAction('t1', lead, ai, parts);
    expect(ai.reply).toContain('23/10 às 16:00');
    expect(ai.action).toBe('none');
    expect(ai.stage).toBe('lead_quente');
  });

  it('reschedule usa o agendamento atual da cliente', async () => {
    const agenda: any = {
      nextActiveForLead: jest.fn().mockResolvedValue({ id: 'a1', serviceId: 'svc-fita' }),
      reschedule: jest.fn().mockResolvedValue({ id: 'a1', startDateTime: new Date('2026-10-24T13:00:00Z') }),
      book: jest.fn(),
    };
    const { svc } = build(agenda);
    const ai: any = { action: 'reschedule', appointmentDateTime: '2026-10-24T10:00:00', reply: 'Remarcado!' };
    await svc.applyAction('t1', lead, ai, parts);
    expect(agenda.reschedule).toHaveBeenCalledWith('t1', 'a1', expect.objectContaining({ serviceId: 'svc-fita' }), { source: 'ia' });
    expect(agenda.book).not.toHaveBeenCalled();
    expect(ai.stage).toBe('agendado');
  });

  it('cancel sem agendamento ativo não finge que cancelou', async () => {
    const agenda: any = { nextActiveForLead: jest.fn().mockResolvedValue(null), cancel: jest.fn() };
    const { svc } = build(agenda);
    const ai: any = { action: 'cancel', reply: 'Cancelado!' };
    await svc.applyAction('t1', lead, ai, parts);
    expect(agenda.cancel).not.toHaveBeenCalled();
    expect(ai.reply).toMatch(/Não encontrei/);
  });

  it('erro inesperado vira resposta segura', async () => {
    const agenda: any = { nextActiveForLead: jest.fn().mockResolvedValue(null), book: jest.fn().mockRejectedValue(new Error('db caiu')) };
    const { svc } = build(agenda);
    const ai: any = { action: 'schedule', agendaServiceCode: 'S1', appointmentDateTime: '2026-10-23T14:00:00', reply: 'Agendado!' };
    await svc.applyAction('t1', lead, ai, parts);
    expect(ai.reply).toMatch(/probleminha/);
    expect(ai.action).toBe('none');
  });

  it('registerCheck recusa código de serviço desconhecido e aceita o válido', async () => {
    const { svc, leadRepo } = build({});
    expect(await svc.registerCheck('t1', { ...lead }, { agendaServiceCode: 'S9', agendaDate: '2030-01-10' } as any, parts)).toBe(false);
    const l = { ...lead };
    expect(await svc.registerCheck('t1', l, { agendaServiceCode: 'S2', agendaDate: '2030-01-10' } as any, parts)).toBe(true);
    expect(l.agendaState).toEqual(expect.objectContaining({ serviceId: 'svc-queratina', date: '2030-01-10' }));
    expect(leadRepo.update).toHaveBeenCalledTimes(1);
  });

  it('aviso de WhatsApp tem cliente, serviço, horário, profissional e origem', () => {
    const msg = buildAgendaMessage('remarcado', { clientName: 'Maria', clientPhone: '84999990000', service: 'Fita adesiva', startDateTime: new Date('2026-10-23T17:00:00Z') } as any, 'Ana', new Date('2026-10-22T13:00:00Z'), 'ia');
    expect(msg).toContain('Agendamento remarcado');
    expect(msg).toContain('Maria (84999990000)');
    expect(msg).toContain('14:00');
    expect(msg).toContain('antes:');
    expect(msg).toContain('Ana');
    expect(msg).toContain('Pela IA');
  });
});

describe('syncRawJson', () => {
  it('reescreve reply/action/stage no JSON salvo no histórico', () => {
    const { syncRawJson } = require('./agenda-ai.service');
    const ai: any = { reply: 'Tenho livre 10h', action: 'none', stage: 'lead_quente', rawJson: JSON.stringify({ reply: 'velho', action: 'check_availability', stage: 'agendado', tags: ['x'] }) };
    syncRawJson(ai);
    expect(JSON.parse(ai.rawJson)).toEqual({ reply: 'Tenho livre 10h', action: 'none', stage: 'lead_quente', tags: ['x'] });
  });
});
