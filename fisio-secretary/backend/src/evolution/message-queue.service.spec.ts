import { MessageQueueService } from './message-queue.service';

describe('MessageQueueService — uma resposta por cliente de cada vez', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  it('junta mensagens dentro do debounce numa chamada só', async () => {
    const q = new MessageQueueService();
    const calls: string[] = [];
    q.enqueue('t:1', 'oi', (txt) => { calls.push(txt); });
    jest.advanceTimersByTime(5000);
    q.enqueue('t:1', 'quanto custa?', (txt) => { calls.push(txt); });
    jest.advanceTimersByTime(15000);
    await flush();
    expect(calls).toEqual(['oi\nquanto custa?']);
  });

  it('não roda duas respostas em paralelo; o que chegou no meio sai junto depois', async () => {
    const q = new MessageQueueService();
    const calls: string[] = [];
    let finishFirst!: () => void;
    const cb = (txt: string) => {
      calls.push(txt);
      if (calls.length === 1) return new Promise<void>((r) => { finishFirst = r; });
      return Promise.resolve();
    };

    q.enqueue('t:1', 'valor do 75cm', cb);
    jest.advanceTimersByTime(15000);
    await flush();
    expect(calls).toEqual(['valor do 75cm']);

    // Duas mensagens passam do debounce enquanto a 1ª resposta ainda está saindo.
    q.enqueue('t:1', 'eu uso 200g', cb);
    jest.advanceTimersByTime(15000);
    q.enqueue('t:1', 'divide em quantas?', cb);
    jest.advanceTimersByTime(15000);
    await flush();
    expect(calls).toHaveLength(1);

    finishFirst();
    await flush();
    expect(calls).toEqual(['valor do 75cm', 'eu uso 200g\ndivide em quantas?']);
  });

  it('clientes diferentes não esperam um pelo outro', async () => {
    const q = new MessageQueueService();
    const calls: string[] = [];
    q.enqueue('t:1', 'a', (txt) => { calls.push(txt); return new Promise(() => {}); });
    q.enqueue('t:2', 'b', (txt) => { calls.push(txt); });
    jest.advanceTimersByTime(15000);
    await flush();
    expect(calls.sort()).toEqual(['a', 'b']);
  });

  it('libera a fila se a resposta travar (teto de 3 min)', async () => {
    const q = new MessageQueueService();
    const calls: string[] = [];
    q.enqueue('t:1', 'a', (txt) => { calls.push(txt); return new Promise(() => {}); });
    jest.advanceTimersByTime(15000);
    await flush();
    q.enqueue('t:1', 'b', (txt) => { calls.push(txt); });
    jest.advanceTimersByTime(15000);
    await flush();
    expect(calls).toEqual(['a']);
    jest.advanceTimersByTime(3 * 60 * 1000);
    await flush();
    expect(calls).toEqual(['a', 'b']);
  });

  it('erro no processamento não trava a fila', async () => {
    const q = new MessageQueueService();
    const calls: string[] = [];
    q.enqueue('t:1', 'a', () => { calls.push('a'); return Promise.reject(new Error('falhou')); });
    jest.advanceTimersByTime(15000);
    await flush();
    q.enqueue('t:1', 'b', (txt) => { calls.push(txt); });
    jest.advanceTimersByTime(15000);
    await flush();
    expect(calls).toEqual(['a', 'b']);
  });
});
