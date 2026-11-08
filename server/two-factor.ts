import crypto from 'node:crypto';
import { Secret, TOTP } from 'otpauth';
import { decrypt, safeEqual, sha256 } from './crypto.ts';
import { getSetting, setSetting } from './db.ts';

export function totp(secret: string, email = '') {
  return new TOTP({ issuer: 'FlowVault', label: email, algorithm: 'SHA1', digits: 6, period: 30, secret: Secret.fromBase32(secret) });
}

export function newTotpSecret() {
  return new Secret({ size: 20 }).base32;
}

export function twoFactorEnabled() {
  return !!getSetting('admin_totp_secret');
}

/** The counter is stored after acceptance so a code cannot authenticate twice. */
export function totpCounter(secret: string, code: string, after = -1, now = Date.now()) {
  const token = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(token)) return null;
  const delta = totp(secret).validate({ token, timestamp: now, window: 1, afterCounter: after });
  return delta === null ? null : Math.floor(now / 30_000) + delta;
}

export function recoveryHashes(): string[] {
  return JSON.parse(getSetting('admin_recovery_hashes') ?? '[]');
}

export function newRecoveryCodes() {
  const codes = Array.from({ length: 10 }, () => crypto.randomBytes(16).toString('hex').toUpperCase().match(/.{4}/g)!.join('-'));
  setSetting('admin_recovery_hashes', JSON.stringify(codes.map((code) => sha256(code.replaceAll('-', '')))));
  return codes;
}

/** Synchronous read-and-consume; no await between checking and invalidating a factor. */
export function consumeSecondFactor(code: string) {
  const encrypted = getSetting('admin_totp_secret');
  if (!encrypted) return false;
  const normalized = code.replace(/[\s-]/g, '').toUpperCase();
  if (/^[A-F0-9]{32}$/.test(normalized)) {
    const hashes = recoveryHashes();
    const index = hashes.findIndex((hash) => safeEqual(hash, sha256(normalized)));
    if (index < 0) return false;
    hashes.splice(index, 1);
    setSetting('admin_recovery_hashes', JSON.stringify(hashes));
    return true;
  }
  if (!/^\d{6}$/.test(normalized)) return false;
  const counter = totpCounter(decrypt(encrypted), code, Number(getSetting('admin_totp_counter') ?? -1));
  if (counter === null) return false;
  setSetting('admin_totp_counter', String(counter));
  return true;
}
