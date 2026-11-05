import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

// Criptografia simétrica (AES-256-GCM) para tokens de integração guardados no banco
// (ex.: chave da API da Trinks por cliente). A chave vem do env INTEGRATIONS_ENC_KEY — qualquer
// texto longo; o sha256 dele vira a chave de 32 bytes. Formato salvo: v1:<iv>:<tag>:<dados> (base64).

export class SecretBoxKeyMissingError extends Error {
  constructor() {
    super('INTEGRATIONS_ENC_KEY não configurada — não dá para salvar/ler tokens de integração');
  }
}

function keyFrom(secret: string | undefined): Buffer {
  if (!secret || secret.trim().length < 16) throw new SecretBoxKeyMissingError();
  return createHash('sha256').update(secret.trim()).digest();
}

export function encryptSecret(plain: string, secret: string | undefined = process.env.INTEGRATIONS_ENC_KEY): string {
  const key = keyFrom(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), data.toString('base64')].join(':');
}

export function decryptSecret(box: string, secret: string | undefined = process.env.INTEGRATIONS_ENC_KEY): string {
  const [v, iv, tag, data] = (box ?? '').split(':');
  if (v !== 'v1' || !iv || !tag || !data) throw new Error('Token criptografado em formato inválido');
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(secret), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

// Para mostrar na tela sem revelar: "j7Hw…ofHo".
export function maskSecret(plain: string | null | undefined): string {
  const s = plain ?? '';
  if (s.length <= 8) return s ? '••••' : '';
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}
