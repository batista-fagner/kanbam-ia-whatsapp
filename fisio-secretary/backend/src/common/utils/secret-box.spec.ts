import { decryptSecret, encryptSecret, maskSecret, SecretBoxKeyMissingError } from './secret-box';

const KEY = 'chave-de-teste-com-mais-de-16-caracteres';

describe('secret-box', () => {
  it('criptografa e lê de volta', () => {
    const box = encryptSecret('valor-ficticio-123', KEY);
    expect(box.startsWith('v1:')).toBe(true);
    expect(box).not.toContain('valor-ficticio-123');
    expect(decryptSecret(box, KEY)).toBe('valor-ficticio-123');
  });

  it('cada criptografia sai diferente (iv aleatório)', () => {
    expect(encryptSecret('abc', KEY)).not.toBe(encryptSecret('abc', KEY));
  });

  it('chave errada não abre', () => {
    const box = encryptSecret('abc', KEY);
    expect(() => decryptSecret(box, 'outra-chave-com-mais-de-16-caracteres')).toThrow();
  });

  it('sem chave configurada, recusa', () => {
    expect(() => encryptSecret('abc', '')).toThrow(SecretBoxKeyMissingError);
    expect(() => encryptSecret('abc', undefined)).toThrow(SecretBoxKeyMissingError);
  });

  it('mascara para exibição', () => {
    expect(maskSecret('AAAA1234567890ZZZZ')).toBe('AAAA…ZZZZ');
    expect(maskSecret('')).toBe('');
    expect(maskSecret('curto')).toBe('••••');
  });
});
