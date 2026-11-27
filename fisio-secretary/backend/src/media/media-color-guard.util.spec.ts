import { filterMediaByColor, mediaKind } from './media-color-guard.util';

describe('media-color-guard', () => {
  it('classifica as mídias reais da DALU', () => {
    expect(mediaKind('como fica nossa fita adesiva aplicada')).toBe('technique');
    expect(mediaKind('video de aplicação de queratina')).toBe('technique');
    expect(mediaKind('tela costurada nossa costura')).toBe('technique');
    expect(mediaKind('video de cabelo no metodo queratina sendo aplicado')).toBe('technique');
    expect(mediaKind('foto de cabelos loiros brasileiros')).toBe('blonde');
    expect(mediaKind('loiro raiz esfumada')).toBe('blonde');
    expect(mediaKind('cabelo iluminado ou com mechas')).toBe('blonde');
    expect(mediaKind('Foto de cabelo regional castanho 60 cm liso')).toBe('dark');
    expect(mediaKind('cabelo cacheado')).toBe('hair');
    expect(mediaKind('cabelos ondulados 60cm regionais')).toBe('hair');
  });

  it('caso real: cor nunca dita → barra os 3 loiros, deixa a técnica', () => {
    const lead = 'Olá! Gostaria de mais detalhes sobre as aplicações de mega hair, por favor. Primeira vez Tenho pouco cabelo [imagem] Oq vc acha Vc tem alguma fts Sim Qual o valor? Dessa fita Manda Fotos Sim';
    const r = filterMediaByColor(
      ['foto de cabelos loiros brasileiros', 'video de cabelo loiro brasileiro 100g', 'foto de cabelo loiro brasileiro 75cm', 'como fica nossa fita adesiva aplicada'],
      lead,
    );
    expect(r.allowed).toEqual(['como fica nossa fita adesiva aplicada']);
    expect(r.blocked).toHaveLength(3);
  });

  it('cliente quer manter o tom escuro → castanho e sem cor passam, loiro não', () => {
    const r = filterMediaByColor(
      ['Foto de cabelo regional castanho 60 cm liso', 'cabelo cacheado', 'foto de cabelos loiros brasileiros'],
      'quero manter meu tom, sou morena',
    );
    expect(r.allowed).toEqual(['Foto de cabelo regional castanho 60 cm liso', 'cabelo cacheado']);
    expect(r.blocked).toEqual(['foto de cabelos loiros brasileiros']);
  });

  it('cliente quer clarear → loiro passa, castanho não', () => {
    const r = filterMediaByColor(['loiro raiz esfumada', 'cabelo importado castanho 65cm'], 'Quero ficar loira!');
    expect(r.allowed).toEqual(['loiro raiz esfumada']);
    expect(r.blocked).toEqual(['cabelo importado castanho 65cm']);
  });

  it('"pouco cabelo" não conta como cor', () => {
    expect(filterMediaByColor(['cabelo cacheado'], 'tenho pouco cabelo').blocked).toEqual(['cabelo cacheado']);
  });
});

describe('media-color-guard — palavras que não são cor', () => {
  it('"claro que sim" e "pretendo" não liberam foto de cabelo', () => {
    expect(filterMediaByColor(['cabelo cacheado', 'loiro raiz esfumada'], 'Claro que sim, pretendo fazer').allowed).toEqual([]);
  });
});
