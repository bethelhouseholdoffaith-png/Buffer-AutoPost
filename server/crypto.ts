import crypto from 'crypto';

const BOOT_FALLBACK_KEY = crypto.randomBytes(32);
let warnedFallback = false;

function getEncryptionKey(): Buffer {
  const raw = (process.env.CREDENTIALS_ENCRYPTION_KEY || '').trim();
  if (raw) {
    if (/^[0-9a-f]{64}$/i.test(raw)) {
      return Buffer.from(raw, 'hex');
    }
    return crypto.createHash('sha256').update(raw, 'utf8').digest();
  }

  const sessionSecret = (process.env.SESSION_SECRET || '').trim();
  if (sessionSecret) {
    return crypto.createHash('sha256').update(`cred:${sessionSecret}`, 'utf8').digest();
  }

  if (!warnedFallback) {
    warnedFallback = true;
    console.warn(
      '[AutoBuffer Security] CREDENTIALS_ENCRYPTION_KEY is not set; using ephemeral in-memory key. Set CREDENTIALS_ENCRYPTION_KEY in .env for persistent cross-restart decryption.'
    );
  }
  return BOOT_FALLBACK_KEY;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = String(storedHash || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;
  try {
    const derived = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(expectedHex, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function generateOpaqueToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(String(rawToken || ''), 'utf8').digest('hex');
}

export function encryptSecret(plaintext: string): string {
  const clean = String(plaintext || '').trim();
  if (!clean) return '';
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(clean, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `gcm1$${iv.toString('hex')}$${tag.toString('hex')}$${encrypted.toString('hex')}`;
}

export function decryptSecret(payload: string | null | undefined): string {
  if (!payload) return '';
  const parts = String(payload).split('$');
  if (parts.length !== 4 || parts[0] !== 'gcm1') return '';
  const [, ivHex, tagHex, dataHex] = parts;
  try {
    const key = getEncryptionKey();
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(ivHex, 'hex')
    );
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataHex, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    return '';
  }
}
