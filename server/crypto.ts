import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { DATA_DIR } from './db.ts';

/**
 * Schlüssel für die Verschlüsselung der n8n-API-Keys.
 * Entweder über APP_SECRET (empfohlen in Produktion) oder automatisch
 * erzeugt in data/secret.key. Geht dieser Schlüssel verloren, müssen die
 * API-Keys der Instanzen neu eingetragen werden.
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
  return zlib.gzipSync(JSON.stringify(obj));
}

export function unpack<T = unknown>(blob: Uint8Array): T {
  return JSON.parse(zlib.gunzipSync(blob).toString('utf8')) as T;
}
