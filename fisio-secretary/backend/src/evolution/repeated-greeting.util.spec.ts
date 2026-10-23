import { stripRepeatedGreeting } from './repeated-greeting.util';

describe('stripRepeatedGreeting', () => {
  it('corta o "Oooi!" da segunda mensagem (caso real da DALU)', () => {
    expect(stripRepeatedGreeting('Oooi! Trabalhamos com mega hair, sim. Você já usa ou vai ser a primeira vez?'))
      .toBe('Trabalhamos com mega hair, sim. Você já usa ou vai ser a primeira vez?');
  });

  it('corta saudação + apresentação juntas', () => {
    expect(stripRepeatedGreeting('Oooi, boa noite! Eu sou a Lu ✨ Como posso te ajudar?')).toBe('Como posso te ajudar?');
    expect(stripRepeatedGreeting('Oi! Seja bem-vinda. Me conta o que você procura.')).toBe('Me conta o que você procura.');
  });

  it('corta "Eu me chamo Lu" e variações', () => {
    expect(stripRepeatedGreeting('Diana, eu me chamo Lu ✨ Você já usou extensões?')).toBe('Diana. Você já usou extensões?');
    expect(stripRepeatedGreeting('Me chamo Lu. Você já usou extensões?')).toBe('Você já usou extensões?');
  });

  it('funciona com acento e emoji depois da saudação', () => {
    expect(stripRepeatedGreeting('Olá! 😊 Fazemos manutenção, sim.')).toBe('Fazemos manutenção, sim.');
  });

  it('corta em cada bolha', () => {
    expect(stripRepeatedGreeting('Oi! Certo.|||Oooi, tudo bem? Qual técnica você usa?')).toBe('Certo.|||Tudo bem? Qual técnica você usa?');
  });

  it('não mexe em palavras que só começam parecido', () => {
    expect(stripRepeatedGreeting('Oitenta gramas ficam R$ 100.')).toBe('Oitenta gramas ficam R$ 100.');
    expect(stripRepeatedGreeting('Olaria fica longe.')).toBe('Olaria fica longe.');
  });

  it('não mexe no meio da frase', () => {
    expect(stripRepeatedGreeting('Certinho! Qualquer coisa me chama, oi?')).toBe('Certinho! Qualquer coisa me chama, oi?');
  });

  it('resposta que era só saudação volta como estava', () => {
    expect(stripRepeatedGreeting('Oooi!')).toBe('Oooi!');
  });

  it('vazio ou sem saudação passa direto', () => {
    expect(stripRepeatedGreeting('')).toBe('');
    expect(stripRepeatedGreeting('Qual técnica você usa?')).toBe('Qual técnica você usa?');
  });
});
