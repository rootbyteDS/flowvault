import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createUpdateService } from './updates.ts';

const url = 'https://deploy.example.test/hooks/private-credential';
const env = { UPDATE_WEBHOOK_URL: url, UPDATE_WEBHOOK_TOKEN: 'private-token', UPDATE_MANAGEMENT_URL: 'https://deploy.example.test/projects/flowvault' };

test('update controls are disabled unless an administrator configures a valid destination', async () => {
  const disabled = createUpdateService({});
  assert.deepEqual(disabled.info(), { enabled: false, reason: 'not_configured', managementUrl: null });
  await assert.rejects(disabled.trigger(), { status: 503 });
  for (const UPDATE_WEBHOOK_URL of ['not a url', 'file:///etc/passwd', 'ftp://example.test', 'https://user:pass@example.test/trigger', 'https://example.test/trigger#fragment']) {
    const service = createUpdateService({ UPDATE_WEBHOOK_URL });
    assert.equal(service.info().reason, 'invalid_configuration');
    await assert.rejects(service.trigger(), { status: 503 });
  }
  const invalidToken = createUpdateService({ ...env, UPDATE_WEBHOOK_TOKEN: 'token\r\nBad: header' });
  assert.equal(invalidToken.info().enabled, false);
  assert.equal(createUpdateService({ ...env, UPDATE_MANAGEMENT_URL: 'javascript:alert(1)' }).info().managementUrl, null);
});

test('the trigger sends only build metadata to the configured destination and never exposes credentials', async () => {
  let calls = 0;
  const service = createUpdateService(env, async (input, init) => {
    calls++;
    assert.equal(String(input), url);
    assert.equal(init?.method, 'POST');
    assert.equal(init?.redirect, 'error');
    assert.ok(init?.signal);
    assert.deepEqual(init?.headers, { 'Content-Type': 'application/json', Authorization: 'Bearer private-token' });
    const payload = JSON.parse(String(init?.body));
    assert.deepEqual(Object.keys(payload).sort(), ['app', 'requestedAt', 'revision', 'version']);
    assert.equal(payload.app, 'flowvault');
    assert.match(payload.version, /^\d+\.\d+\.\d+/);
    return new Response('secret response should never be returned', { status: 202 });
  });
  assert.deepEqual(service.info(), { enabled: true, reason: null, managementUrl: env.UPDATE_MANAGEMENT_URL });
  const result = await service.trigger();
  assert.equal(result.status, 'accepted');
  assert.ok(result.requestedAt > 0);
  assert.equal(calls, 1);
  assert.equal(JSON.stringify([result, service.info()]).includes('private-'), false);
  await assert.rejects(service.trigger(), { status: 429 });
  assert.equal(calls, 1);
});

test('parallel requests cannot start two deployments', async () => {
  let finish!: (r: Response) => void;
  const service = createUpdateService(env, () => new Promise<Response>((resolve) => { finish = resolve; }));
  const first = service.trigger();
  await assert.rejects(service.trigger(), { status: 409 });
  finish(new Response(null, { status: 202 }));
  assert.equal((await first).status, 'accepted');
});

test('remote errors, redirects and timeouts never leak credentials or imply installation success', async () => {
  for (const status of [302, 401, 403, 500]) {
    const service = createUpdateService(env, async () => new Response('private-token', { status }));
    await assert.rejects(service.trigger(), (err: Error & { status?: number }) => {
      assert.equal(err.status, 502);
      assert.deepEqual((err as Error & { params?: unknown }).params, { status });
      assert.match(err.message, new RegExp(`HTTP ${status}`));
      assert.equal(err.message.includes('private-'), false);
      return true;
    });
  }
  let attempts = 0;
  const disconnected = createUpdateService(env, async () => { attempts++; throw new Error(`${url} private-token`); });
  await assert.rejects(disconnected.trigger(), (err: Error & { status?: number }) => {
    assert.equal(err.status, 502);
    // Sprachunabhängig prüfen: Der Schlüssel entscheidet, nicht der Wortlaut in der Server-Sprache
    assert.equal((err as Error & { key?: string }).key, 'errors.update.noConfirmation');
    assert.equal(err.message.includes('private-'), false);
    return true;
  });
  await assert.rejects(disconnected.trigger(), { status: 429 });
  assert.equal(attempts, 1);
});

test('a deliberate new request is possible after the cooldown, without automatic retries', async (t) => {
  let now = 1_750_000_000_000;
  t.mock.method(Date, 'now', () => now);
  let calls = 0;
  const service = createUpdateService({ UPDATE_WEBHOOK_URL: url }, async (_input, init) => {
    calls++;
    assert.equal(new Headers(init?.headers).has('Authorization'), false);
    return new Response(null, { status: 200 });
  });
  await service.trigger();
  now += 119_999;
  await assert.rejects(service.trigger(), { status: 429 });
  now++;
  await service.trigger();
  assert.equal(calls, 2);
});
