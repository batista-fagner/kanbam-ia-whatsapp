import { PixQueueService } from '../payments/pix-queue.service';
import { FollowupQueueService } from '../followup/followup-queue.service';
import { FollowupTriggerQueueService } from '../followup/followup-trigger-queue.service';
import { QUEUE_ENGINE_BULLMQ } from './queue.constants';

// O BullMQ rejeita jobId contendo ':' ("Custom Id cannot contain :") porque o caractere é
// reservado nas chaves internas dele. Um ':' aqui faz o add LANÇAR — a cadeia de PIX nunca
// começa e o follow-up nunca é despachado. Como o jobId é montado por interpolação, é fácil
// alguém reintroduzir o ':' sem perceber; estes testes trancam o formato.
describe('jobId das filas — nunca pode conter ":"', () => {
  const config = { get: () => QUEUE_ENGINE_BULLMQ } as any;
  const TENANT_ID = '2c562828-0fe9-43c8-bad0-77a931968afc'; // uuid real tem hífens, não dois-pontos

  const capture = () => {
    const add = jest.fn().mockResolvedValue(undefined);
    const remove = jest.fn().mockResolvedValue(undefined);
    return { add, remove, jobIds: () => add.mock.calls.map((c) => c[2].jobId) };
  };

  it('PIX: primeiro elo e reagendamento saem sem ":"', async () => {
    const q = capture();
    const svc = new PixQueueService({ add: q.add } as any, config);

    await svc.startCheckChain('tenant', TENANT_ID, 'txid1');
    await svc.scheduleNextCheck('tenant', TENANT_ID, 'txid1', 3);
    await svc.startCheckChain('implantacao', TENANT_ID, 'txid2');

    for (const id of q.jobIds()) expect(id).not.toContain(':');
    // Elos distintos precisam de ids distintos: o job anterior ainda ocupa o id base
    // enquanto é finalizado, e um add com id existente é descartado em silêncio.
    expect(new Set(q.jobIds()).size).toBe(3);
  });

  it('Follow-up: enqueue e requeue saem sem ":" e não colidem entre si', async () => {
    const q = capture();
    const svc = new FollowupQueueService({ add: q.add, remove: q.remove } as any, config);

    await svc.enqueue('f1', new Date(Date.now() + 60_000));
    await svc.requeue('f1', 5 * 60_000);

    const [enqueued, requeued] = q.jobIds();
    expect(enqueued).not.toContain(':');
    expect(requeued).not.toContain(':');
    expect(enqueued).not.toBe(requeued);
  });

  it('cancel remove exatamente o jobId do enqueue (senão o job sobrevive ao cancelamento)', async () => {
    const q = capture();
    const svc = new FollowupQueueService({ add: q.add, remove: q.remove } as any, config);

    await svc.enqueue('f1', new Date());
    await svc.cancel('f1');

    expect(q.remove).toHaveBeenCalledWith(q.jobIds()[0]);
  });

  it('Gatilhos do follow-up: ids sem ":", determinísticos e distintos no reagendamento', async () => {
    const q = capture();
    const svc = new FollowupTriggerQueueService({ add: q.add } as any, config);
    const idle = { tenantId: TENANT_ID, leadId: 'l1', stage: 'novo_lead', messageId: 'm1' };
    const cad = { tenantId: TENANT_ID, leadId: 'l1', anchor: 1792900000000 };
    const rem = { appointmentId: 'a1', startMs: 1792900000000 };

    await svc.scheduleIdleCheck(idle, new Date());
    await svc.scheduleIdleCheck(idle, new Date());             // mesmo gatilho emitido de novo
    await svc.scheduleIdleCheck(idle, new Date(), 'w123');     // reagendado de dentro do job
    await svc.scheduleCadenceStep(cad, new Date());
    await svc.scheduleReminder(rem, 24, new Date());
    await svc.scheduleReminder(rem, 2, new Date());            // antecedência mudou na config
    await svc.schedulePostSale({ tenantId: TENANT_ID, leadId: 'l1', entryId: 'h1' }, 2, new Date());

    const ids = q.jobIds();
    for (const id of ids) expect(id).not.toContain(':');
    expect(ids[0]).toBe(ids[1]);    // dedupe pelo BullMQ
    expect(ids[2]).not.toBe(ids[0]);
    expect(ids[4]).not.toBe(ids[5]);
  });

  // Com QUEUE_ENGINE legado nada deve ir parar na fila — é o que garante o rollback.
  it('modo legado não enfileira nada', async () => {
    const q = capture();
    const legacy = { get: () => 'legacy-cron' } as any;
    const pix = new PixQueueService({ add: q.add } as any, legacy);
    const fup = new FollowupQueueService({ add: q.add, remove: q.remove } as any, legacy);

    await pix.startCheckChain('tenant', TENANT_ID, 'txid1');
    await fup.enqueue('f1', new Date());
    await fup.requeue('f1', 1000);
    const trig = new FollowupTriggerQueueService({ add: q.add } as any, legacy);
    await trig.scheduleIdleCheck({ tenantId: TENANT_ID, leadId: 'l1', stage: 'novo_lead', messageId: 'm1' }, new Date());

    expect(q.add).not.toHaveBeenCalled();
  });
});
