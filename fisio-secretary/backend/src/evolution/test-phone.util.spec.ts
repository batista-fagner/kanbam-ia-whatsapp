import { isAllowedInTestMode, normalizeTestPhone } from './test-phone.util';

describe('modo teste da IA (número único)', () => {
  it('sem número configurado, responde a todos', () => {
    expect(isAllowedInTestMode(null, '5571999990000')).toBe(true);
    expect(isAllowedInTestMode('', '5571999990000')).toBe(true);
    expect(isAllowedInTestMode('123', '5571999990000')).toBe(true); // curto demais = desligado
  });

  it('só responde ao número configurado', () => {
    expect(isAllowedInTestMode('5571992867765', '5571992867765')).toBe(true);
    expect(isAllowedInTestMode('5571992867765', '5571988887777')).toBe(false);
  });

  it('aceita máscara e variações com/sem 55 e 9º dígito', () => {
    expect(isAllowedInTestMode('(71) 99286-7765', '5571992867765')).toBe(true);
    expect(isAllowedInTestMode('557192867765', '5571992867765')).toBe(true);
    expect(isAllowedInTestMode('71992867765', '557192867765')).toBe(true);
  });

  it('normaliza para só dígitos', () => {
    expect(normalizeTestPhone('+55 (71) 99286-7765')).toBe('5571992867765');
    expect(normalizeTestPhone('abc')).toBeNull();
  });
});
