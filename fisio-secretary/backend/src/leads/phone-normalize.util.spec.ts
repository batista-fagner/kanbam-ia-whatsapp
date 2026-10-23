import { normalizeWhatsAppPhone, phoneAlternates } from './phone-normalize.util';

describe('normalizeWhatsAppPhone', () => {
  it('DDD 31+ tira o 9 (formato do WhatsApp)', () => {
    expect(normalizeWhatsAppPhone('(84) 99999-8888')).toBe('558499998888');
    expect(normalizeWhatsAppPhone('+55 71 9 9286-7765')).toBe('557192867765');
    expect(normalizeWhatsAppPhone('557192867765')).toBe('557192867765');
  });

  it('DDD 11-28 mantém ou acrescenta o 9', () => {
    expect(normalizeWhatsAppPhone('11 99999-8888')).toBe('5511999998888');
    expect(normalizeWhatsAppPhone('27 9999-8888')).toBe('5527999998888');
    expect(normalizeWhatsAppPhone('5521999998888')).toBe('5521999998888');
  });

  it('fixo fica como está', () => {
    expect(normalizeWhatsAppPhone('(11) 3333-4444')).toBe('551133334444');
    expect(normalizeWhatsAppPhone('84 3333-4444')).toBe('558433334444');
  });

  it('aceita zero de longa distância e 00', () => {
    expect(normalizeWhatsAppPhone('0 84 99999-8888')).toBe('558499998888');
    expect(normalizeWhatsAppPhone('0055 84 99999-8888')).toBe('558499998888');
  });

  it('estrangeiro com código do país passa direto', () => {
    expect(normalizeWhatsAppPhone('+351 912 345 678')).toBe('351912345678');
  });

  it('recusa lixo', () => {
    expect(normalizeWhatsAppPhone('')).toBeNull();
    expect(normalizeWhatsAppPhone('99999-8888')).toBeNull();
    expect(normalizeWhatsAppPhone('84 89999-8888')).toBeNull();
    expect(normalizeWhatsAppPhone('Maria')).toBeNull();
  });
});

describe('phoneAlternates', () => {
  it('gera a grafia com/sem 9 e sem 55', () => {
    expect(phoneAlternates('558499998888')).toEqual(expect.arrayContaining(['5584999998888', '8499998888', '84999998888']));
    expect(phoneAlternates('5511999998888')).toEqual(expect.arrayContaining(['551199998888', '11999998888']));
  });
});
