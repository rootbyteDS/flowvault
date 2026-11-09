import type { UpdateInfo } from '../shared/system.ts';
import { fail } from '../shared/i18n/server.ts';
import { buildInfo } from './version.ts';

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
    if (!info.enabled) fail(503, 'errors.update.notConfigured');
    if (pending) fail(409, 'errors.update.inProgress');
    if (lastAttempt !== null && Date.now() - lastAttempt < 120_000) fail(429, 'errors.update.tooSoon');
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
          fail(502, 'errors.update.noConfirmation');
        }
        // A trigger should acknowledge quickly. Never proxy remote output (which may contain credentials).
        void response.body?.cancel().catch(() => {});
        if (!response.ok) fail(502, 'errors.update.rejected', { status: response.status });
        return { status: 'accepted' as const, requestedAt };
      } finally {
        pending = false;
      }
    },
  };
}

export const updates = createUpdateService();
