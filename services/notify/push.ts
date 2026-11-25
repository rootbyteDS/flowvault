/**
 * Ausgehende Zero-Payload-Tickles an UnifiedPush-Distributoren (z. B. selbst gehostetes ntfy / Sunup).
 *
 * Sicherheitsprinzip:
 * - Über den Push-Endpunkt verlassen NIE Workflow-Namen, Nodes oder Fehlermeldungen FlowVault –
 *   ausschließlich `{ v: 1, t: "wake", seq }`.
 * - Strikter SSRF-Schutz: keine Weiterleitungen, Cloud-Metadaten/Loopback/Link-Local immer blockiert.
 *   Private Netze (LAN/Docker-ntfy) nur bei ausdrücklichem Opt-in (NOTIFY_ALLOW_PRIVATE_PUSH=1 oder Allowlist).
 */
import dns from 'node:dns/promises';
import net from 'node:net';
import { HttpError } from '../../shared/i18n/server.ts';

export interface PushPolicy {
  allowPrivate: boolean;
  allowlist: Set<string>;
}

export function pushPolicyFromEnv(env: NodeJS.ProcessEnv = process.env): PushPolicy {
  const allowPrivate = env.NOTIFY_ALLOW_PRIVATE_PUSH === '1';
  const raw = (env.NOTIFY_PUSH_ALLOWLIST ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return { allowPrivate, allowlist: new Set(raw) };
}

function isAlwaysBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    // 0.0.0.0/8, 127.0.0.0/8 (Loopback), 169.254.0.0/16 (Link-Local / Cloud Metadata)
    return a === 0 || a === 127 || (a === 169 && b === 254);
  }
  const v6 = ip.toLowerCase();
  if (v6 === '::' || v6 === '::1' || v6 === 'fd00:ec2::254') return true;
  const mappedDotted = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedDotted) return isAlwaysBlockedIp(mappedDotted[1]!);
  const mappedHex = v6.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1]!, 16);
    const lo = parseInt(mappedHex[2]!, 16);
    return isAlwaysBlockedIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return /^fe[89ab][0-9a-f]:/.test(v6); // fe80::/10
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 10) return true;
    if (a === 172 && b! >= 16 && b! <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b! >= 64 && b! <= 127) return true; // CGNAT / Tailscale
    return false;
  }
  const v6 = ip.toLowerCase();
  const mappedDotted = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedDotted) return isPrivateIp(mappedDotted[1]!);
  return /^f[cd][0-9a-f]{2}:/.test(v6); // fc00::/7 ULA
}

export async function validatePushEndpoint(
  rawUrl: string,
  policy: PushPolicy = pushPolicyFromEnv(),
  lookup: (host: string) => Promise<{ address: string }[]> = (h) => dns.lookup(h, { all: true, verbatim: true }),
): Promise<string> {
  let u: URL;
  try {
    u = new URL(rawUrl.trim());
  } catch {
    throw new HttpError(400, 'errors.notify.invalidPushUrl');
  }
  if (u.username || u.password) throw new HttpError(400, 'errors.notify.invalidPushUrl');
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const inAllowlist = policy.allowlist.has(host);

  if (u.protocol !== 'https:') {
    if (!(u.protocol === 'http:' && (policy.allowPrivate || inAllowlist))) {
      throw new HttpError(400, 'errors.notify.pushHttpsRequired');
    }
  }
  if (!host || host === 'localhost' || host.endsWith('.localhost') || /^metadata(\.google\.internal)?\.?$/i.test(host)) {
    throw new HttpError(400, 'errors.notify.pushBlocked');
  }

  let addrs: { address: string }[];
  if (net.isIP(host)) {
    addrs = [{ address: host }];
  } else {
    try {
      addrs = await lookup(host);
    } catch {
      return u.toString(); // Nicht auflösbar im Test/Offline-Fall: beim Senden schlägt fetch fehl
    }
  }
  for (const a of addrs) {
    if (isAlwaysBlockedIp(a.address)) throw new HttpError(400, 'errors.notify.pushBlocked');
    if (isPrivateIp(a.address) && !policy.allowPrivate && !inAllowlist) {
      throw new HttpError(400, 'errors.notify.pushPrivateBlocked');
    }
  }
  return u.toString();
}

export interface PushSender {
  sendWakeup: (endpoint: string, seq: number) => Promise<boolean>;
}

export function createPushSender(
  policy: PushPolicy = pushPolicyFromEnv(),
  fetchImpl: typeof fetch = fetch,
  lookup?: (host: string) => Promise<{ address: string }[]>,
): PushSender {
  return {
    async sendWakeup(endpoint: string, seq: number): Promise<boolean> {
      try {
        const validated = await validatePushEndpoint(endpoint, policy, lookup);
        const res = await fetchImpl(validated, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', TTL: '300' },
          body: JSON.stringify({ v: 1, t: 'wake', seq }),
          redirect: 'manual',
          signal: AbortSignal.timeout(8_000),
        });
        if (res.status >= 300 && res.status < 400) {
          void res.body?.cancel();
          return false;
        }
        void res.body?.cancel();
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}
