import { findServiceConflict, mentionsAll, mentionsAny } from './service-mention.util';

const corte = { id: 'corte', name: 'Corte de cabelo' };
const aval = { id: 'aval', name: 'Avaliação' };
const aval2 = { id: 'aval2', name: 'avaliação' };
const fita = { id: 'fita', name: 'Fita adesiva' };
const telas2 = { id: 't2', name: 'Manutenção de 2 telas' };
const italiano = { id: 'it', name: 'Método Italiano' };
const all = [corte, aval, aval2, fita, telas2, italiano];
const approved = new Set(['corte', 'fita', 't2']);

describe('mentionsAny / mentionsAll', () => {
  it('ignora acento, caixa e flexão', () => {
    expect(mentionsAll('Sim! A AVALIAÇÃO', 'Avaliação')).toBe(true);
    expect(mentionsAny('quero avaliar meu cabelo', 'Avaliação')).toBe(true);
    expect(mentionsAny('quero cortar as pontas', 'Corte de cabelo')).toBe(true); // "cortar" conta como corte
    expect(mentionsAny('quero um corte', 'Corte de cabelo')).toBe(true);
  });
  it('"cabelo" sozinho não identifica serviço', () => {
    expect(mentionsAny('meu cabelo está ruim', 'Corte de cabelo')).toBe(false);
  });
  it('número solto não casa com data (21/11)', () => {
    expect(mentionsAny('amanhã 21/11 às 11h', 'Manutenção de 2 telas')).toBe(false);
    expect(mentionsAll('manutenção de 2 telas', 'Manutenção de 2 telas')).toBe(true);
    expect(mentionsAll('manutenção de 3 telas', 'Manutenção de 2 telas')).toBe(false);
  });
});

describe('findServiceConflict', () => {
  it('caso da DALU: pediu avaliação (não liberada) e a IA escolheu corte → conflito unapproved', () => {
    const texts = ['Sim!\nA avaliação', 'Estou disponível o dia todo.', 'Sim, eu gostaria de ir fazer uma avaliação!', 'eu tive um corte químico'];
    const c = findServiceConflict(texts, corte, all, approved, { confirming: false });
    expect(c?.kind).toBe('unapproved');
    expect(c?.service.name.toLowerCase()).toBe('avaliação');
  });

  it('a mensagem MAIS RECENTE manda: "corte químico" antigo não esconde o pedido de avaliação', () => {
    const c = findServiceConflict(['quero avaliação', 'meu corte químico'], corte, all, approved);
    expect(c?.kind).toBe('unapproved');
  });

  it('avaliação aprovada e escolhida → sem conflito (mesmo com a linha duplicada não aprovada)', () => {
    const ap = new Set(['aval']);
    expect(findServiceConflict(['quero avaliação'], aval, all, ap)).toBeNull();
  });

  it('cliente não nomeou serviço nenhum → sem conflito', () => {
    expect(findServiceConflict(['pode ser sábado', 'às 11h'], corte, all, approved)).toBeNull();
  });

  it('nomeou outro serviço liberado: só conflita na hora do "sim"', () => {
    const texts = ['sim, mas é fita adesiva'];
    expect(findServiceConflict(texts, corte, all, approved, { confirming: false })).toBeNull();
    const c = findServiceConflict(texts, corte, all, approved, { confirming: true });
    expect(c).toMatchObject({ kind: 'other', service: { id: 'fita' } });
  });

  it('confirmando o mesmo serviço que a IA escolheu → sem conflito', () => {
    expect(findServiceConflict(['sim, o corte mesmo'], corte, all, approved, { confirming: true })).toBeNull();
  });

  it('serviço não liberado e sem vínculo (Método Italiano) também trava', () => {
    expect(findServiceConflict(['quero o método italiano'], corte, all, approved)?.kind).toBe('unapproved');
  });
});
