import crypto from 'node:crypto';
import net from 'node:net';
import type { Request, Response, NextFunction } from 'express';
import { db, getSetting, setSetting } from './db.ts';
import { hashPassword, randomToken, safeEqual, sha256, verifyPassword } from './crypto.ts';
import { requestT, t } from '../shared/i18n/server.ts';

const COOKIE = 'fv_session';
const TTL = 30 * 24 * 60 * 60 * 1000;

export function readCookie(req: Request, name: string) {
  const header = req.headers.cookie ?? '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k !== name) continue;
    try {
      return decodeURIComponent(v.join('='));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function isSetUp() {
  return !!(process.env.ADMIN_PASSWORD || getSetting('admin_password'));
}

export function adminEmail() {
  return (process.env.ADMIN_EMAIL || getSetting('admin_email') || '').trim().toLowerCase();
}

export function sessionHash(req: Request) {
  const token = readCookie(req, COOKIE);
  return token ? sha256(token) : '';
}

export function setAuthCookie(req: Request, res: Response, name: string, token: string, ttl: number) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.append('Set-Cookie', `${name}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${ttl / 1000}${secure ? '; Secure' : ''}`);
}

// ───────────── Ersteinrichtung ─────────────

/**
 * Einmal-Code für die Ersteinrichtung. Er steht nur im Server-Log – sonst würde
 * Admin, wer eine frisch gestartete Instanz zuerst im Browser aufruft.
 * Wird bei jedem Start neu erzeugt, solange noch kein Passwort gesetzt ist.
 */
let setupCode: string | null = null;

export function announceSetupCode() {
  if (isSetUp()) return;
  setupCode = crypto.randomBytes(6).toString('hex').toUpperCase().replace(/(.{4})(?=.)/g, '$1-');
  console.log(`  ${t('log.setupCode', { code: setupCode })}\n`);
}

/** Prüft den Code und verbraucht ihn bei Erfolg, damit parallele Einrichtungen scheitern. */
export function consumeSetupCode(code: string) {
  const norm = (s: string) => s.replace(/[\s-]/g, '').toUpperCase();
  if (!setupCode || !safeEqual(norm(code), norm(setupCode))) return false;
  setupCode = null;
  return true;
}

// ───────────── Passwort ─────────────

export async function checkPassword(pw: string) {
  if (process.env.ADMIN_PASSWORD) return safeEqual(pw, process.env.ADMIN_PASSWORD);
  const stored = getSetting('admin_password');
  return !!stored && (await verifyPassword(pw, stored));
}

export async function setPassword(pw: string) {
  setSetting('admin_password', await hashPassword(pw));
}

// ───────────── Sitzungen ─────────────
// In der Datenbank steht nur der SHA-256 des Tokens: Ein Datenbank-Leak ergibt keine gültigen Sitzungen.

export function isAuthenticated(req: Request) {
  const token = readCookie(req, COOKIE);
  if (!token) return false;
  const row = db.prepare('SELECT expires_at FROM sessions WHERE token = ?').get(sha256(token)) as { expires_at: number } | undefined;
  return !!row && row.expires_at > Date.now();
}

export function createSession(req: Request, res: Response) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(sessionHash(req));
  const token = randomToken();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions (token, expires_at) VALUES (?, ?)').run(sha256(token), Date.now() + TTL);
  setAuthCookie(req, res, COOKIE, token, TTL);
}

export function destroySession(req: Request, res: Response) {
  const token = readCookie(req, COOKIE);
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(sha256(token));
  setAuthCookie(req, res, COOKIE, '', 0);
}

/** Meldet alle Geräte ab, z. B. nach einem Passwortwechsel. */
export function destroyAllSessions() {
  db.prepare('DELETE FROM sessions').run();
  db.prepare('DELETE FROM auth_challenges').run();
  setSetting('auth_revision', randomToken());
}

export function requireSession(req: Request, res: Response, next: NextFunction) {
  if (isAuthenticated(req)) return next();
  res.status(401).json({ error: requestT(req)('errors.http.unauthenticated') });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  requireSession(req, res, () => {
    if (!adminEmail()) return res.status(403).json({ error: requestT(req)('errors.http.emailRequired') });
    next();
  });
}

// ───────────── Bremse gegen Passwort-Raten ─────────────
// Pro Adresse sperren Fehlversuche mit wachsender Wartezeit. Laufende Prüfungen zählen mit: Parallel gesendete
// Versuche werden nicht öfter geprüft als nacheinander gesendete. Eine zweite Bremse über alle Adressen begrenzt
// verteilte Angriffe und die Zahl gleichzeitiger Passwortprüfungen (scrypt braucht je rund 16 MB Speicher).

/** Acht Gruppen à vier Hex-Ziffern; nur für Adressen, die `net.isIPv6` akzeptiert. */
function ipv6Groups(ip: string): string[] {
  let s = ip.split('%')[0]!.toLowerCase();
  const v4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number) as [number, number, number, number];
    s = `${s.slice(0, v4.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = '', tail] = s.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const fill = tail === undefined ? [] : Array<string>(8 - left.length - right.length).fill('0');
  return [...left, ...fill, ...right].map((g) => g.padStart(4, '0'));
}

/**
 * Schlüssel der Login-Sperre für eine Client-Adresse. IPv6 zählt pro /64-Netz: Ein Anschluss bekommt meist
 * ein ganzes /64 und könnte sonst mit jeder neuen Adresse von vorn anfangen. IPv4 (auch in IPv6 verpackt)
 * zählt pro Adresse; alles andere bleibt unverändert.
 */
export function addressKey(ip: string): string {
  if (!net.isIPv6(ip)) return ip;
  const g = ipv6Groups(ip);
  if (g.slice(0, 5).every((x) => x === '0000') && g[5] === 'ffff') {
    const n = parseInt(g[6]! + g[7]!, 16);
    return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
  }
  return `${g.slice(0, 4).join(':')}::/64`;
}

export interface LoginThrottleOptions {
  /** Fehlversuche pro Adresse bis zur Sperre */
  limit?: number;
  /** Fehlversuche über alle Adressen innerhalb von `globalWindow` (ms), ab denen die Anmeldung für alle pausiert */
  globalLimit?: number;
  globalWindow?: number;
  /** Gleichzeitig laufende Prüfungen über alle Adressen */
  maxPending?: number;
}

/** Eine laufende Prüfung verfällt spätestens nach dieser Zeit, damit ein verlorenes Ende nie dauerhaft sperrt. */
const PENDING_TTL = 2 * 60_000;

export function createLoginThrottle({ limit = 5, globalLimit = 50, globalWindow = 15 * 60_000, maxPending = 8 }: LoginThrottleOptions = {}) {
  type Running = { key: string; at: number };
  const perKey = new Map<string, { n: number; until: number; last: number; running: Set<Running> }>();
  const running = new Set<Running>();
  /** Zeitpunkte der letzten Fehlversuche über alle Adressen, älteste zuerst, höchstens `globalLimit` */
  const failures: number[] = [];

  const entry = (key: string) => {
    let a = perKey.get(key);
    if (!a) perKey.set(key, (a = { n: 0, until: 0, last: 0, running: new Set() }));
    return a;
  };

  function prune(now: number) {
    while (failures.length && (failures[0]! <= now - globalWindow || failures.length > globalLimit)) failures.shift();
    for (const r of running) {
      if (r.at > now - PENDING_TTL) continue;
      running.delete(r);
      perKey.get(r.key)?.running.delete(r);
    }
  }

  /** Sekunden bis zum nächsten erlaubten Versuch; 0 = jetzt erlaubt. */
  function wait(key: string): number {
    const now = Date.now();
    prune(now);
    let ms = 0;
    const a = perKey.get(key);
    if (a && a.until > now) ms = a.until - now;
    // Nie mehr Prüfungen gleichzeitig, als bis zur Sperre übrig sind – nach Ablauf einer Sperre also nur eine
    if (a && a.running.size >= Math.max(1, limit - a.n)) ms = Math.max(ms, 1000);
    if (failures.length >= globalLimit) ms = Math.max(ms, failures[0]! + globalWindow - now);
    else if (failures.length + running.size >= globalLimit || running.size >= maxPending) ms = Math.max(ms, 1000);
    return Math.ceil(ms / 1000);
  }

  /** Meldet eine beginnende Prüfung an. Die zurückgegebene Funktion meldet sie ab; mehrfacher Aufruf schadet nicht. */
  function begin(key: string): () => void {
    const r = { key, at: Date.now() };
    const a = entry(key);
    a.last = r.at;
    a.running.add(r);
    running.add(r);
    return () => {
      running.delete(r);
      perKey.get(key)?.running.delete(r);
    };
  }

  function failed(key: string) {
    const now = Date.now();
    const a = entry(key);
    a.n++;
    a.last = now;
    if (a.n >= limit) a.until = now + Math.min(60_000 * 2 ** (a.n - limit), 15 * 60_000);
    failures.push(now);
    prune(now);
  }

  /** Setzt nur die Adresse zurück; die Bremse über alle Adressen läuft weiter. */
  function succeeded(key: string) {
    const a = perKey.get(key);
    if (!a) return;
    a.n = 0;
    a.until = 0;
    if (!a.running.size) perKey.delete(key);
  }

  // Einträge ohne Versuch in der letzten Stunde vergessen, damit die Liste nicht unbegrenzt wächst
  setInterval(() => {
    const now = Date.now();
    prune(now);
    for (const [key, a] of perKey) if (!a.running.size && a.until < now && a.last < now - 60 * 60_000) perKey.delete(key);
  }, 10 * 60_000).unref();

  return { wait, begin, failed, succeeded };
}

export type LoginThrottle = ReturnType<typeof createLoginThrottle>;

export const loginThrottle = createLoginThrottle();
