import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { db, getSetting, setSetting } from './db.ts';
import { hashPassword, randomToken, safeEqual, sha256, verifyPassword } from './crypto.ts';

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
  console.log(`  Einrichtungscode für das Admin-Konto: ${setupCode}\n`);
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
  res.status(401).json({ error: 'Nicht angemeldet' });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  requireSession(req, res, () => {
    if (!adminEmail()) return res.status(403).json({ error: 'Bitte zuerst die Admin-E-Mail hinterlegen' });
    next();
  });
}

// ───────────── Bremse gegen Passwort-Raten ─────────────

const attempts = new Map<string, { n: number; until: number; last: number }>();

export function loginThrottle(ip: string) {
  const a = attempts.get(ip);
  if (a && a.until > Date.now()) return Math.ceil((a.until - Date.now()) / 1000);
  return 0;
}
export function loginFailed(ip: string) {
  const a = attempts.get(ip) ?? { n: 0, until: 0, last: 0 };
  a.n++;
  a.last = Date.now();
  if (a.n >= 5) a.until = Date.now() + Math.min(60_000 * 2 ** (a.n - 5), 15 * 60_000);
  attempts.set(ip, a);
}
export function loginSucceeded(ip: string) {
  attempts.delete(ip);
}

// Einträge ohne Fehlversuch in der letzten Stunde vergessen, damit die Liste nicht unbegrenzt wächst
setInterval(() => {
  const cutoff = Date.now() - 60 * 60_000;
  for (const [ip, a] of attempts) if (a.last < cutoff && a.until < Date.now()) attempts.delete(ip);
}, 10 * 60_000).unref();
