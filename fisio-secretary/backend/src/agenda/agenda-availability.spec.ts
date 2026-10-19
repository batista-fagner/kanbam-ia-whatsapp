import { computeDay, pickProfessional, isProfessionalFree, AvailabilityContext } from './agenda-availability';
import { toSPDate } from '../common/utils/sp-time.util';

// 2026-10-23 é sexta (weekday 5)
const DAY = '2026-10-23';
const salon = { '5': [{ start: '09:00', end: '18:00' }] };
const at = (hhmm: string, date = DAY) => toSPDate(date, hhmm);

function ctx(over: Partial<AvailabilityContext> = {}): AvailabilityContext {
  return {
    professionals: [
      { id: 'ana', sortOrder: 0, weeklyHours: {}, serviceIds: ['fita', 'escova'] },
      { id: 'bia', sortOrder: 1, weeklyHours: { '5': [{ start: '13:00', end: '18:00' }] }, serviceIds: ['fita'] },
    ],
    salonHours: salon,
    gridMinutes: 60,
    earliest: at('00:00'),
    appointments: [],
    blocks: [],
    ...over,
  };
}

describe('agenda-availability', () => {
  it('serviço longo não cabe no fim do expediente', () => {
    const d = computeDay(ctx(), 'fita', 120, DAY);
    const times = d.slots.map((s) => s.time);
    expect(times[0]).toBe('09:00');
    expect(times).toContain('16:00');
    expect(times).not.toContain('17:00');
    expect(d.weekday).toBe('sex');
  });

  it('usa o horário próprio do profissional quando definido', () => {
    const d = computeDay(ctx(), 'fita', 60, DAY);
    const nine = d.slots.find((s) => s.time === '09:00')!;
    expect(nine.professionalIds).toEqual(['ana']);
    const two = d.slots.find((s) => s.time === '14:00')!;
    expect(two.professionalIds.sort()).toEqual(['ana', 'bia']);
  });

  it('só considera quem faz o serviço', () => {
    const d = computeDay(ctx(), 'escova', 60, DAY);
    expect(d.slots.every((s) => s.professionalIds.length === 1 && s.professionalIds[0] === 'ana')).toBe(true);
  });

  it('conflito é por profissional: horário da Ana ocupado continua livre com a Bia', () => {
    const c = ctx({ appointments: [{ professionalId: 'ana', start: at('14:00'), end: at('15:00') }] });
    const two = computeDay(c, 'fita', 60, DAY).slots.find((s) => s.time === '14:00')!;
    expect(two.professionalIds).toEqual(['bia']);
    const ten = computeDay(c, 'fita', 60, DAY).slots.find((s) => s.time === '10:00')!;
    expect(ten.professionalIds).toEqual(['ana']);
  });

  it('agendamento que começa no meio também bloqueia (sobreposição parcial)', () => {
    const c = ctx({ appointments: [{ professionalId: 'ana', start: at('10:30'), end: at('11:30') }] });
    const p = c.professionals[0];
    expect(isProfessionalFree(c, p, at('10:00'), 60)).toBe(false);
    expect(isProfessionalFree(c, p, at('11:30'), 60)).toBe(true);
  });

  it('bloqueio do salão tira todo mundo; bloqueio do profissional só ele', () => {
    const geral = ctx({ blocks: [{ professionalId: null, start: at('14:00'), end: at('15:00') }] });
    expect(computeDay(geral, 'fita', 60, DAY).slots.find((s) => s.time === '14:00')).toBeUndefined();
    const soBia = ctx({ blocks: [{ professionalId: 'bia', start: at('13:00'), end: at('18:00') }] });
    expect(computeDay(soBia, 'fita', 60, DAY).slots.find((s) => s.time === '14:00')!.professionalIds).toEqual(['ana']);
  });

  it('respeita a antecedência mínima', () => {
    const d = computeDay(ctx({ earliest: at('12:30') }), 'fita', 60, DAY);
    expect(d.slots[0].time).toBe('13:00');
  });

  it('dia fechado não tem horário', () => {
    expect(computeDay(ctx(), 'fita', 60, '2026-10-25').slots).toEqual([]); // domingo
  });

  it('escolhe quem tem menos atendimentos no dia', () => {
    const c = ctx({ appointments: [{ professionalId: 'ana', start: at('09:00'), end: at('10:00') }] });
    expect(pickProfessional(c, 'fita', 60, at('15:00'))).toBe('bia');
    expect(pickProfessional(ctx(), 'fita', 60, at('15:00'))).toBe('ana'); // empate → ordem cadastrada
    expect(pickProfessional(c, 'fita', 60, at('09:00'))).toBeNull(); // Bia só a partir das 13h
  });

  it('grade de 30 min', () => {
    const d = computeDay(ctx({ gridMinutes: 30 }), 'escova', 60, DAY);
    expect(d.slots.slice(0, 3).map((s) => s.time)).toEqual(['09:00', '09:30', '10:00']);
    expect(d.slots[d.slots.length - 1].time).toBe('17:00');
  });
});
