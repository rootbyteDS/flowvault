/**
 * Ausgehende Requests zu n8n und zur KI-API.
 * - Folgt keinen Weiterleitungen: fetch würde Header wie X-N8N-API-KEY sonst auch an
 *   eine fremde Domain mitschicken (nur `Authorization` wird dort entfernt).
 * - Blockt link-lokale Adressen, u. a. die Cloud-Metadaten-Dienste (169.254.169.254).
 *   Private Netze (10.x, 192.168.x, Docker-Hostnamen) bleiben erlaubt – dort läuft n8n oft.
 */
import dns from 'node:dns/promises';
import net from 'node:net';
import { LocalizedError } from '../shared/i18n/index.ts';

/** Fehler eines ausgehenden Requests. Eigene Meldungen sind übersetzbar, wörtliche Antworten fremder Dienste nicht. */
export class FetchError extends LocalizedError {}

function isBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || (a === 169 && b === 254);
  }
  const v6 = ip.toLowerCase();
  if (v6 === '::' || v6 === 'fd00:ec2::254') return true; // unspezifiziert, AWS-Metadaten (IPv6)
  const mappedDotted = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedDotted) return isBlockedIp(mappedDotted[1]);
  const mappedHex = v6.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    return isBlockedIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return /^fe[89ab][0-9a-f]:/.test(v6); // fe80::/10
}

async function assertAllowedTarget(url: URL) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new FetchError({ key: 'errors.net.onlyHttp' });
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const blocked = { key: 'errors.net.blocked' } as const;
  if (/^metadata(\.google\.internal)?\.?$/i.test(host)) throw new FetchError(blocked);
  let addrs: { address: string }[];
  try {
    addrs = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    return; // Nicht auflösbar – fetch scheitert gleich mit einer passenden Meldung
  }
  if (addrs.some((a) => isBlockedIp(a.address))) throw new FetchError(blocked);
}

export async function safeFetch(url: string, init: RequestInit): Promise<Response> {
  const u = new URL(url);
  await assertAllowedTarget(u);
  const res = await fetch(u, { ...init, redirect: 'manual' });
  if (res.status >= 300 && res.status < 400) {
    void res.body?.cancel();
    let origin = '';
    try {
      const loc = res.headers.get('location');
      if (loc) origin = new URL(loc, u).origin;
    } catch {}
    throw new FetchError(origin ? { key: 'errors.net.redirectTo', params: { origin } } : { key: 'errors.net.redirect' }, res.status);
  }
  return res;
}

/** Fehlermeldung aus einer JSON-Antwort – rohe Antworttexte (HTML, interne Dienste) werden nie durchgereicht. */
export function errorMessageFrom(text: string, status: number): string {
  try {
    const j = JSON.parse(text);
    const m = j?.error?.message ?? j?.message;
    if (typeof m === 'string' && m.trim()) return m;
  } catch {}
  return `HTTP ${status}`;
}
