import type { UpdateInfo } from '../shared/system.ts';
import { buildInfo } from './version.ts';

function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}

function httpUrl(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.hash ? url : null;
  } catch { return null; }
}

/** Only deployment configuration supplies the destination; browser input is never forwarded. */
export function createUpdateService(env: NodeJS.ProcessEnv = process.env, request: typeof fetch = fetch) {
  const hook = httpUrl(env.UPDATE_WEBHOOK_URL);
  const token = env.UPDATE_WEBHOOK_TOKEN || '';
  const invalid = (!!env.UPDATE_WEBHOOK_URL && !hook) || /[\r\n]/.test(token);
  const managementUrl = httpUrl(env.UPDATE_MANAGEMENT_URL)?.href ?? null;
  const info: UpdateInfo = {
    enabled: !!hook && !invalid,
    reason: invalid ? 'invalid_configuration' : !hook ? 'not_configured' : null,
    managementUrl,
  };
  let pending = false;
  let lastAttempt: number | null = null;

  function assertReady() {
    if (!info.enabled) fail(503, 'Der Update-Auslöser ist nicht eingerichtet. Bitte die Deployment-Konfiguration prüfen.');
    if (pending) fail(409, 'Eine Update-Anfrage wird bereits gesendet');
    if (lastAttempt !== null && Date.now() - lastAttempt < 120_000) fail(429, 'Bitte zuerst den Deployment-Status prüfen und mindestens zwei Minuten warten');
  }

  return {
    info: () => ({ ...info }),
    assertReady,
    async trigger() {
      assertReady();
      pending = true;
      lastAttempt = Date.now();
      const requestedAt = lastAttempt;
      try {
        let response: Response;
        try {
          response = await request(hook!, {
            method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: JSON.stringify({ app: 'flowvault', version: buildInfo.version, revision: buildInfo.revision, requestedAt }),
          });
        } catch {
          // A disconnect can occur after acceptance. Never expose transport errors or auto-retry.
          fail(502, 'Keine Bestätigung vom Update-Dienst erhalten. Ob das Update gestartet wurde, ist unklar. Bitte dort den Status prüfen.');
        }
        // A trigger should acknowledge quickly. Never proxy remote output (which may contain credentials).
        void response.body?.cancel().catch(() => {});
        if (!response.ok) fail(502, `Der Update-Dienst hat die Anfrage abgelehnt (HTTP ${response.status}). Bitte dort den Status prüfen.`);
        return { status: 'accepted' as const, requestedAt };
      } finally {
        pending = false;
      }
    },
  };
}

export const updates = createUpdateService();
