import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { DATA_DIR } from './db.ts';

/**
 * Schlüssel für n8n-API-Keys, TOTP-Geheimnisse und Workflow-Snapshots.
 * Entweder über APP_SECRET (empfohlen in Produktion) oder automatisch
 * erzeugt in data/secret.key. Ohne ursprünglichen Schlüssel sind verschlüsselte
 * Workflow-Versionen nicht lesbar. Datenbank und Schlüssel zusammengehörig sichern.
 */
function loadKey(): Buffer {
  if (process.env.APP_SECRET) {
    return crypto.createHash('sha256').update(process.env.APP_SECRET).digest();
  }
  const file = path.join(DATA_DIR, 'secret.key');
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, crypto.randomBytes(32).toString('base64'), { mode: 0o600 });
  }
  return Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
}

const KEY = loadKey();

// Eigenes, versioniertes Binärformat: Header | Nonce (12) | GCM-Tag (16) | Ciphertext.
// Der Header wird mit authentifiziert; ein beschädigtes Format fällt nicht auf Klartext zurück.
const SNAPSHOT_HEADER = Buffer.from('FVSP\x01', 'ascii');
const SNAPSHOT_KEY = Buffer.from(crypto.hkdfSync('sha256', KEY, Buffer.alloc(0), 'flowvault:snapshot:v1', 32));

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}

export function decrypt(payload: string): string {
  const [iv, tag, enc] = payload.split('.').map((s) => Buffer.from(s, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

// Asynchron, damit Anmeldeversuche den Server nicht blockieren
const scrypt = (pw: string, salt: Buffer, len: number) =>
  new Promise<Buffer>((resolve, reject) => crypto.scrypt(pw, salt, len, (err, key) => (err ? reject(err) : resolve(key))));

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, saltB64, hashB64] = stored.split('$');
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

/** Vergleich in konstanter Zeit, auch bei unterschiedlicher Länge. */
export function safeEqual(a: string, b: string): boolean {
  const h = (s: string) => crypto.createHash('sha256').update(s).digest();
  return crypto.timingSafeEqual(h(a), h(b));
}

export function randomToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

export function pack(obj: unknown): Uint8Array {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', SNAPSHOT_KEY, iv, { authTagLength: 16 });
  cipher.setAAD(SNAPSHOT_HEADER);
  const enc = Buffer.concat([cipher.update(zlib.gzipSync(JSON.stringify(obj))), cipher.final()]);
  return Buffer.concat([SNAPSHOT_HEADER, iv, cipher.getAuthTag(), enc]);
}

export function isEncryptedSnapshot(blob: Uint8Array): boolean {
  return Buffer.from(blob.subarray(0, SNAPSHOT_HEADER.length)).equals(SNAPSHOT_HEADER);
}

export function unpack<T = unknown>(blob: Uint8Array, { allowLegacy = false }: { allowLegacy?: boolean } = {}): T {
  const data = Buffer.from(blob);
  // Nur das bisherige gzip-Format wird als Altbestand akzeptiert (für die Migration).
  if (allowLegacy && data[0] === 0x1f && data[1] === 0x8b && data[2] === 0x08) {
    return JSON.parse(zlib.gunzipSync(data).toString('utf8')) as T;
  }
  const offset = SNAPSHOT_HEADER.length;
  if (!isEncryptedSnapshot(data) || data.length <= offset + 28) throw new Error('Invalid encrypted snapshot format');
  const decipher = crypto.createDecipheriv('aes-256-gcm', SNAPSHOT_KEY, data.subarray(offset, offset + 12), { authTagLength: 16 });
  decipher.setAAD(SNAPSHOT_HEADER);
  decipher.setAuthTag(data.subarray(offset + 12, offset + 28));
  const compressed = Buffer.concat([decipher.update(data.subarray(offset + 28)), decipher.final()]);
  return JSON.parse(zlib.gunzipSync(compressed).toString('utf8')) as T;
}
