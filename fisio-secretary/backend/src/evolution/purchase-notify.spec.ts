import { EvolutionController } from './evolution.controller';

const CLAUDIA = 'ebb0a430-3c61-4957-8efb-e98239d1a562';

// Aviso de intenção de compra SEM handoff (Claudia): só manda WhatsApp pro número cadastrado,
// nunca responde pela IA nem desliga a IA do lead (isso é o comportamento da S&A).
describe('EvolutionController — maybeNotifyPurchaseIntent', () => {
  let controller: any;
  let evolutionService: any;
  let leadsService: any;
  const lead = { id: 'lead-1', name: 'Maria', phone: '5531999990000' };
  const config = { notificationPhone: '5531988887777' };

  beforeEach(() => {
    evolutionService = { sendTextMessage: jest.fn().mockResolvedValue(undefined) };
    leadsService = { toggleAi: jest.fn(), saveMessage: jest.fn() };
    controller = new EvolutionController(
      evolutionService, {} as any, {} as any, {} as any, leadsService, {} as any, {} as any,
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
      {} as any, {} as any, {} as any,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('avisa o número cadastrado quando a cliente diz "quero fechar"', () => {
    controller.maybeNotifyPurchaseIntent(lead, config, 'tok', CLAUDIA, 'gostei, quero fechar hoje');

    expect(evolutionService.sendTextMessage).toHaveBeenCalledTimes(1);
    const [to, text] = evolutionService.sendTextMessage.mock.calls[0];
    expect(to).toBe('5531988887777');
    expect(text).toContain('Intenção de compra');
    expect(text).toContain('Maria');
    expect(text).toContain('quero fechar');
  });

  it('só avisa: não desliga a IA nem responde pela cliente', () => {
    controller.maybeNotifyPurchaseIntent(lead, config, 'tok', CLAUDIA, 'quero comprar');

    expect(leadsService.toggleAi).not.toHaveBeenCalled();
    expect(leadsService.saveMessage).not.toHaveBeenCalled();
    // única mensagem enviada é o aviso pro número da dona, nunca pro telefone da cliente
    expect(evolutionService.sendTextMessage.mock.calls.every((c: any[]) => c[0] !== lead.phone)).toBe(true);
  });

  it('reconhece palavra-chave sem acento e em maiúsculas', () => {
    controller.maybeNotifyPurchaseIntent(lead, config, 'tok', CLAUDIA, 'PODE RESERVAR pra mim');
    expect(evolutionService.sendTextMessage).toHaveBeenCalledTimes(1);
  });

  it('mensagem sem palavra-chave não avisa', () => {
    controller.maybeNotifyPurchaseIntent(lead, config, 'tok', CLAUDIA, 'qual o valor do indiano 65cm?');
    expect(evolutionService.sendTextMessage).not.toHaveBeenCalled();
  });

  it('tenant fora da lista não avisa', () => {
    controller.maybeNotifyPurchaseIntent(lead, config, 'tok', 'outro-tenant', 'quero fechar');
    expect(evolutionService.sendTextMessage).not.toHaveBeenCalled();
  });

  it('cooldown: repetir "quero esse" no mesmo lead não avisa de novo, outro lead avisa', () => {
    controller.maybeNotifyPurchaseIntent(lead, config, 'tok', CLAUDIA, 'quero esse');
    controller.maybeNotifyPurchaseIntent(lead, config, 'tok', CLAUDIA, 'quero esse mesmo');
    expect(evolutionService.sendTextMessage).toHaveBeenCalledTimes(1);

    controller.maybeNotifyPurchaseIntent({ ...lead, id: 'lead-2' }, config, 'tok', CLAUDIA, 'quero esse');
    expect(evolutionService.sendTextMessage).toHaveBeenCalledTimes(2);
  });

  it('depois de 24h o mesmo lead volta a avisar', () => {
    const t0 = Date.now();
    const now = jest.spyOn(Date, 'now').mockReturnValue(t0);
    controller.maybeNotifyPurchaseIntent(lead, config, 'tok', CLAUDIA, 'quero esse');

    now.mockReturnValue(t0 + 25 * 60 * 60 * 1000);
    controller.maybeNotifyPurchaseIntent(lead, config, 'tok', CLAUDIA, 'quero esse');
    expect(evolutionService.sendTextMessage).toHaveBeenCalledTimes(2);
  });

  it('sem número cadastrado: silencioso e NÃO consome o cooldown (avisa assim que ela preencher)', () => {
    controller.maybeNotifyPurchaseIntent(lead, { notificationPhone: null }, 'tok', CLAUDIA, 'quero fechar');
    expect(evolutionService.sendTextMessage).not.toHaveBeenCalled();

    controller.maybeNotifyPurchaseIntent(lead, config, 'tok', CLAUDIA, 'quero fechar');
    expect(evolutionService.sendTextMessage).toHaveBeenCalledTimes(1);
  });
});
