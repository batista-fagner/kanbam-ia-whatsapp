import { AppointmentsService } from './appointments.service';
import { WhatsappConfigService } from '../evolution/whatsapp-config.service';
import { resolveReminderGate } from './reminder-gate';

/**
 * Lembrete de agendamento com antecedência configurável pelo tenant.
 *
 * Duas regras de produto que o teste tranca:
 *  1. Sem mensagem preenchida o lead NÃO recebe nada (mensagem vazia = desligado).
 *  2. A antecedência é escolhida pela usuária (1h, 12h, 24h...) e a janela de busca
 *     tem que respeitar isso — nunca disparar antes do limiar nem em cima da hora.
 */

const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;

// ── Captura o range de datas que findDueReminders manda pro Postgres ─────────
function makeService() {
  const captured: { windowStart?: Date; windowEnd?: Date } = {};
  const qb: any = {
    where: () => qb,
    andWhere: (_sql: string, params?: any) => {
      if (params?.windowStart) captured.windowStart = params.windowStart;
      if (params?.windowEnd) captured.windowEnd = params.windowEnd;
      return qb;
    },
    getMany: async () => [],
  };
  const repo: any = { createQueryBuilder: () => qb };
  return { service: new AppointmentsService(repo), captured };
}

// `enabled` só é aceito com mensagem; o sanitizador é o guardião da regra.
function sanitize(raw: any) {
  const svc = new WhatsappConfigService({} as any, {} as any, {} as any);
  return (svc as any).sanitizeAppointmentReminder(raw);
}

describe('sanitizeAppointmentReminder', () => {
  it('ativado com texto → mantém enabled e a antecedência escolhida', () => {
    expect(sanitize({ enabled: true, message: 'Oi {nome}, é amanhã!', hoursBefore: 12 }))
      .toEqual({ enabled: true, message: 'Oi {nome}, é amanhã!', hoursBefore: 12 });
  });

  it('ativado SEM texto → enabled vira false (lead não pode receber mensagem vazia)', () => {
    expect(sanitize({ enabled: true, message: '', hoursBefore: 24 }).enabled).toBe(false);
  });

  it('ativado só com espaços em branco → também desliga', () => {
    expect(sanitize({ enabled: true, message: '   \n  ', hoursBefore: 24 }).enabled).toBe(false);
  });

  it('desativado com texto → guarda o texto para quando reativar', () => {
    const r = sanitize({ enabled: false, message: 'texto salvo', hoursBefore: 2 });
    expect(r).toEqual({ enabled: false, message: 'texto salvo', hoursBefore: 2 });
  });

  it('config antiga sem hoursBefore → cai em 24h (comportamento anterior à feature)', () => {
    expect(sanitize({ enabled: true, message: 'oi' }).hoursBefore).toBe(24);
  });

  it('hoursBefore inválido (0, negativo, texto, NaN) → 24h', () => {
    for (const v of [0, -5, 'abc', null, undefined, NaN]) {
      expect(sanitize({ enabled: true, message: 'oi', hoursBefore: v }).hoursBefore).toBe(24);
    }
  });

  it('hoursBefore acima do teto → clampa em 168h (7 dias)', () => {
    expect(sanitize({ enabled: true, message: 'oi', hoursBefore: 9999 }).hoursBefore).toBe(168);
  });

  it('hoursBefore fracionário → arredonda', () => {
    expect(sanitize({ enabled: true, message: 'oi', hoursBefore: 1.6 }).hoursBefore).toBe(2);
  });

  it('mensagem gigante é truncada em 1000 chars', () => {
    expect(sanitize({ enabled: true, message: 'a'.repeat(5000) }).message).toHaveLength(1000);
  });

  it('null continua null (nunca configurado)', () => {
    expect(sanitize(null)).toBeNull();
  });
});

describe('findDueReminders — janela por antecedência', () => {
  it('hoursBefore=1 → busca só o que começa na próxima hora', async () => {
    const { service, captured } = makeService();
    const t0 = Date.now();
    await service.findDueReminders('t1', 1);
    // teto = agora + 1h (o alvo configurado)
    expect(captured.windowEnd!.getTime() - t0).toBeGreaterThanOrEqual(HOUR - 1000);
    expect(captured.windowEnd!.getTime() - t0).toBeLessThanOrEqual(HOUR + 1000);
  });

  it('hoursBefore=24 → teto em 24h (mesmo alvo do comportamento antigo)', async () => {
    const { service, captured } = makeService();
    const t0 = Date.now();
    await service.findDueReminders('t1', 24);
    expect(captured.windowEnd!.getTime() - t0).toBeGreaterThanOrEqual(24 * HOUR - 1000);
  });

  it('default sem argumento = 24h (chamador legado não quebra)', async () => {
    const { service, captured } = makeService();
    const t0 = Date.now();
    await service.findDueReminders('t1');
    expect(captured.windowEnd!.getTime() - t0).toBeGreaterThanOrEqual(24 * HOUR - 1000);
  });

  it('piso de 10min: agendamento em cima da hora não entra na janela', async () => {
    const { service, captured } = makeService();
    const t0 = Date.now();
    await service.findDueReminders('t1', 24);
    expect(captured.windowStart!.getTime() - t0).toBeGreaterThanOrEqual(10 * MIN - 1000);
    // e nunca busca no passado
    expect(captured.windowStart!.getTime()).toBeGreaterThan(t0);
  });

  it('janela sempre válida: start < end para todas as opções da UI', async () => {
    for (const h of [1, 2, 3, 6, 12, 24, 48, 72]) {
      const { service, captured } = makeService();
      await service.findDueReminders('t1', h);
      expect(captured.windowStart!.getTime()).toBeLessThan(captured.windowEnd!.getTime());
    }
  });
});

// ── O gate do cron: quem é pulado e com qual antecedência cada tenant é consultado ──
describe('processAppointmentReminders — gate por tenant', () => {
  // Mesma função que o cron (processAppointmentReminders) chama em produção.
  const gate = (reminder: any) => resolveReminderGate(reminder) as { skip: boolean; hoursBefore?: number };

  it('tenant sem lembrete configurado → pulado', () => {
    expect(gate(null).skip).toBe(true);
  });

  it('tenant com lembrete desativado → pulado mesmo tendo texto', () => {
    expect(gate({ enabled: false, message: 'oi', hoursBefore: 12 }).skip).toBe(true);
  });

  it('tenant ativado mas sem texto → pulado (lead não recebe)', () => {
    expect(gate({ enabled: true, message: '  ', hoursBefore: 12 }).skip).toBe(true);
  });

  it('tenant ativado com texto → consulta com a antecedência dele', () => {
    expect(gate({ enabled: true, message: 'oi', hoursBefore: 12 })).toEqual({ skip: false, hoursBefore: 12 });
  });

  it('tenant legado (jsonb sem hoursBefore) → consulta com 24h', () => {
    expect(gate({ enabled: true, message: 'oi' })).toEqual({ skip: false, hoursBefore: 24 });
  });

  it('cada tenant usa a SUA antecedência — um não contamina o outro', () => {
    const configs = [
      { enabled: true, message: 'a', hoursBefore: 1 },
      { enabled: true, message: 'b', hoursBefore: 48 },
      { enabled: true, message: 'c' },
    ];
    expect(configs.map(c => gate(c).hoursBefore)).toEqual([1, 48, 24]);
  });
});
