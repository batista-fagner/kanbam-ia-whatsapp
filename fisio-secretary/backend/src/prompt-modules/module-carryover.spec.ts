import { PromptModulesService } from './prompt-modules.service';

// selectModules decide quais blocos de conhecimento entram no prompt do turno.
// Testa isolado (sem banco, sem LLM) porque é onde nasce o bug de preço
// inventado: se o módulo com a tabela não entra, o modelo responde valor de
// cabeça — foi o que aconteceu na S&A Cabelos Naturais (2026-08-12).
describe('PromptModulesService — arraste de módulos entre turnos', () => {
  let svc: any;
  let classifyModules: jest.Mock;

  // keywords é uma keyword/regex por LINHA (mesmo formato que o cliente digita
  // no painel) — daí o join('\n') em vez de escapar na string.
  const mod = (name: string, keywords: string[], sortOrder: number) =>
    ({ name, keywords: keywords.join('\n'), sortOrder, isCore: false, isActive: true } as any);

  const CORE = { name: 'Core', keywords: '', sortOrder: 0, isCore: true, isActive: true } as any;
  const CATALOGO = mod('Catálogo & Vídeos', ['v[íi]deo', 'liso', '\\bver\\b', 'tamanho'], 1);
  const PRECO = mod('Preço & Gramatura', ['pre[cç]o', 'valor', 'gramatura', '\\bquanto\\b'], 2);
  const AGENDAMENTO = mod('Agendamento', ['agendar', 'marcar'], 4);
  const ALL = [CORE, CATALOGO, PRECO, AGENDAMENTO];

  beforeEach(() => {
    classifyModules = jest.fn().mockResolvedValue([]);
    svc = new PromptModulesService({} as any, {} as any, { classifyModules } as any, {} as any);
  });

  const names = (r: { selected: any[] }) => r.selected.map((m) => m.name);

  it('keyword da mensagem carrega o módulo correspondente', async () => {
    const r = await svc.selectModules('t1', 'qual o valor?', ALL, [], '');
    expect(names(r)).toEqual(['Preço & Gramatura']);
    expect(r.freshNames).toEqual(['Preço & Gramatura']);
  });

  // O caso real: o módulo de Preço manda mostrar o vídeo primeiro e só informar
  // o valor na mensagem SEGUINTE. Nessa mensagem seguinte a cliente diz só
  // "Ok obrigada" — nenhuma keyword de preço bate, só as de vídeo. Antes do
  // arraste o módulo de Preço caía fora e o modelo inventava o valor.
  it('mantém o módulo do turno anterior quando outro casa no turno atual', async () => {
    const priorAssistant = 'Aqui está o vídeo dele! 😍 Quer ver também outra opção parecida?';
    const r = await svc.selectModules('t1', 'Ok obrigada', ALL, ['Preço & Gramatura'], priorAssistant);

    expect(names(r)).toContain('Catálogo & Vídeos');   // sinal deste turno
    expect(names(r)).toContain('Preço & Gramatura');   // arrastado do anterior
    expect(classifyModules).not.toHaveBeenCalled();    // teve match, não gasta LLM
  });

  it('persiste só o sinal do turno — o arraste não vira bola de neve', async () => {
    const priorAssistant = 'Aqui está o vídeo dele!';
    const r = await svc.selectModules('t1', 'Ok obrigada', ALL, ['Preço & Gramatura'], priorAssistant);

    // freshNames é o que vai pro lead.activeModules; sem o módulo arrastado,
    // ele some no turno seguinte em vez de ficar preso pra sempre no prompt.
    expect(r.freshNames).toEqual(['Catálogo & Vídeos']);

    const next = await svc.selectModules('t1', 'Ok obrigada', ALL, r.freshNames, priorAssistant);
    expect(names(next)).toEqual(['Catálogo & Vídeos']);
  });

  it('módulos saem em ordem de sortOrder, independente de sinal ou arraste', async () => {
    const r = await svc.selectModules('t1', 'quero agendar', ALL, ['Catálogo & Vídeos', 'Preço & Gramatura'], '');
    expect(names(r)).toEqual(['Catálogo & Vídeos', 'Preço & Gramatura', 'Agendamento']);
  });

  it('sem keyword nenhuma, cai no classificador barato e ainda soma o anterior', async () => {
    classifyModules.mockResolvedValue(['Agendamento']);
    const r = await svc.selectModules('t1', 'pode ser', ALL, ['Preço & Gramatura'], '');

    expect(classifyModules).toHaveBeenCalled();
    expect(names(r)).toEqual(['Preço & Gramatura', 'Agendamento']);
    expect(r.freshNames).toEqual(['Agendamento']);
  });

  it('nada bate e o classificador não aponta nada: continuidade pura', async () => {
    const r = await svc.selectModules('t1', 'hmm', ALL, ['Preço & Gramatura'], '');
    expect(names(r)).toEqual(['Preço & Gramatura']);
    expect(r.freshNames).toEqual([]);
  });

  it('core nunca entra por keyword (é sempre fixo, fora da seleção)', async () => {
    const r = await svc.selectModules('t1', 'qual o valor?', ALL, [], '');
    expect(names(r)).not.toContain('Core');
  });
});
