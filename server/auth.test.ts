import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, mock, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { defaultDashboardLayout } from '../shared/dashboard.ts';

// All HTTP tests use an isolated database and encryption key, never the installation's data.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flowvault-auth-'));
const savedEnv = { DATA_DIR: process.env.DATA_DIR, ADMIN_PASSWORD: process.env.ADMIN_PASSWORD, ADMIN_EMAIL: process.env.ADMIN_EMAIL, APP_SECRET: process.env.APP_SECRET };
process.env.DATA_DIR = directory;
delete process.env.ADMIN_PASSWORD;
delete process.env.ADMIN_EMAIL;
delete process.env.APP_SECRET;
const { db, getSetting, setSetting } = await import('./db.ts');
const { addressKey, announceSetupCode, createLoginThrottle, requireAuth, setPassword } = await import('./auth.ts');
const { createAuthRouter } = await import('./auth-router.ts');
const { createDashboardRouter } = await import('./dashboard.ts');
const { decrypt, sha256 } = await import('./crypto.ts');
const { totp, totpCounter } = await import('./two-factor.ts');
const { createUpdateService } = await import('./updates.ts');
let updateCalls = 0;
let updateBody = '';
const updateService = createUpdateService({ UPDATE_WEBHOOK_URL: 'https://deploy.example.test/trigger' }, async (_input, init) => {
  updateCalls++;
  updateBody = String(init?.body);
  return new Response(null, { status: 202 });
});
const password = 'test-admin-password';
const email = 'admin@example.com';
const now = 1_750_000_005_000;

const app = express();
app.use(express.json());
// Date.now steht in den Tests still, die Bremse über alle Adressen würde sich also über alle Tests aufsummieren.
// Sie wird unten mit eigenen Instanzen geprüft.
app.use('/api/auth', createAuthRouter((req) => String(req.headers['x-test-ip']), updateService, createLoginThrottle({ globalLimit: 10_000 })));
app.get('/api/protected', requireAuth, (_req, res) => res.json({ ok: true }));
app.use('/api/dashboard', requireAuth, createDashboardRouter());
app.use((err: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(err.status ?? 500).json({ error: err.message });
});
const server = app.listen(0, '127.0.0.1');
let baseUrl: string;
before(async () => {
  if (!server.listening) await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
beforeEach(() => {
  mock.method(Date, 'now', () => now);
  db.exec('DELETE FROM sessions; DELETE FROM auth_challenges; DELETE FROM settings;');
  delete process.env.ADMIN_PASSWORD;
  delete process.env.ADMIN_EMAIL;
});
afterEach(() => mock.restoreAll());
after(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

class Browser {
  cookies = new Map<string, string>();
  ip: string = crypto.randomUUID();
  async request(route: string, body?: unknown, ip = this.ip, method = body === undefined ? 'GET' : 'POST') {
    const response = await fetch(`${baseUrl}${route}`, {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '), 'x-test-ip': ip },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const cookies = response.headers.getSetCookie();
    for (const cookie of cookies) {
      const [key, value] = cookie.split(';')[0]!.split('=');
      if (cookie.includes('Max-Age=0')) this.cookies.delete(key!);
      else this.cookies.set(key!, value!);
    }
    return { status: response.status, body: await response.json(), cookies };
  }
  login() { return this.request('/auth/login', { email, password }); }
  put(route: string, body: unknown) { return this.request(route, body, this.ip, 'PUT'); }
  patch(route: string, body: unknown) { return this.request(route, body, this.ip, 'PATCH'); }
}

async function configured() {
  await setPassword(password);
  setSetting('admin_email', email);
  const browser = new Browser();
  assert.equal((await browser.login()).status, 200);
  return browser;
}

async function enabled() {
  const browser = await configured();
  const setup = await browser.request('/auth/2fa/setup', { current: password });
  assert.equal(setup.status, 200);
  const secret: string = setup.body.secret;
  // Use the previous time step during enrollment so the current code is fresh for login.
  const response = await browser.request('/auth/2fa/enable', { factor: totp(secret).generate({ timestamp: now - 30_000 }) });
  assert.equal(response.status, 200);
  return { browser, secret, codes: response.body.codes as string[] };
}

test('first setup needs a server code, email and password, and can only run once', async (t) => {
  let message = '';
  const logger = t.mock.method(console, 'log', (text: string) => { message += text; });
  announceSetupCode();
  logger.mock.restore();
  const code = message.match(/[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}/)![0];
  const browser = new Browser();
  assert.equal((await browser.request('/auth/setup', { email, password, code: 'wrong' })).status, 403);
  assert.equal((await browser.request('/auth/setup', { email: 'invalid', password, code })).status, 400);
  assert.equal((await browser.request('/auth/setup', { email, password: 'short', code })).status, 400);
  assert.equal((await browser.request('/auth/status')).body.setup, false);
  const result = await browser.request('/auth/setup', { email: ' ADMIN@Example.COM ', password, code });
  assert.equal(result.status, 200);
  assert.ok(result.cookies.some((cookie) => cookie.includes('HttpOnly; SameSite=Strict')));
  assert.equal(getSetting('admin_email'), email);
  assert.notEqual(getSetting('admin_password'), password);
  assert.equal((await browser.request('/protected')).status, 200);
  assert.equal((await browser.request('/auth/setup', { email, password, code })).status, 409);
});

test('legacy password-only login requires verified email migration before any protected access', async () => {
  await setPassword(password);
  const browser = new Browser();
  const other = new Browser();
  assert.equal((await browser.request('/auth/login', { password })).status, 200);
  await other.request('/auth/login', { password });
  assert.equal((await browser.request('/auth/status')).body.emailRequired, true);
  assert.equal((await browser.request('/protected')).status, 403);
  assert.equal((await browser.request('/auth/email', { email, current: 'wrong' })).status, 401);
  assert.equal((await browser.request('/auth/email', { email, current: password })).status, 200);
  assert.equal((await browser.request('/protected')).status, 200);
  assert.equal((await other.request('/protected')).status, 401);
  const fresh = new Browser();
  assert.equal((await fresh.request('/auth/login', { password })).status, 401);
  assert.equal((await fresh.login()).status, 200);
});

test('email and password are both required, normalized, and errors do not reveal which was wrong', async () => {
  await configured();
  const browser = new Browser();
  const wrongEmail = await browser.request('/auth/login', { email: 'wrong@example.com', password });
  const wrongPassword = await browser.request('/auth/login', { email, password: 'wrong' });
  assert.equal(wrongEmail.status, 401);
  assert.deepEqual(wrongEmail.body, wrongPassword.body);
  assert.equal((await browser.request('/auth/login', { email: ' ADMIN@EXAMPLE.COM ', password })).status, 200);
  const anonymous = await new Browser().request('/auth/status');
  assert.equal(anonymous.body.email, undefined);
  assert.equal(anonymous.body.twoFactor, undefined);
});

test('enrollment requires password, is bound to a session, and stores the pending secret encrypted', async () => {
  const browser = await configured();
  const other = new Browser();
  await other.login();
  assert.equal((await browser.request('/auth/2fa/setup', { current: 'wrong' })).status, 401);
  const enrollment = await browser.request('/auth/2fa/setup', { current: password });
  assert.match(enrollment.body.qrCode, /^data:image\/png;base64,/);
  const pending = db.prepare("SELECT secret_enc FROM auth_challenges WHERE kind = 'enroll'").get() as { secret_enc: string };
  assert.notEqual(pending.secret_enc, enrollment.body.secret);
  assert.equal(decrypt(pending.secret_enc), enrollment.body.secret);
  assert.equal((await browser.request('/auth/status')).body.twoFactor, false);
  const factor = totp(enrollment.body.secret).generate({ timestamp: now - 30_000 });
  assert.equal((await other.request('/auth/2fa/enable', { factor })).status, 400);
  assert.equal((await browser.request('/auth/2fa/enable', { factor: 'wrong' })).status, 400);
  const result = await browser.request('/auth/2fa/enable', { factor });
  assert.equal(result.status, 200);
  assert.equal(result.body.codes.length, 10);
  assert.equal(new Set(result.body.codes).size, 10);
  assert.equal((await other.request('/protected')).status, 401);
  assert.equal((await browser.request('/protected')).status, 200);
  assert.equal(decrypt(getSetting('admin_totp_secret')!), enrollment.body.secret);
  const stored = getSetting('admin_recovery_hashes')!;
  for (const code of result.body.codes) {
    assert.equal(stored.includes(code), false);
    assert.ok(stored.includes(sha256(code.replaceAll('-', ''))));
  }
});

test('password alone cannot access protected routes with 2FA, and a TOTP cannot be reused', async () => {
  const { secret } = await enabled();
  const browser = new Browser();
  const result = await browser.login();
  assert.deepEqual(result.body, { twoFactorRequired: true });
  assert.equal(browser.cookies.has('fv_session'), false);
  assert.equal((await browser.request('/protected')).status, 401);
  assert.equal((await browser.request('/auth/email', { email: 'takeover@example.com', current: password })).status, 401);
  const challenge = browser.cookies.get('fv_login')!;
  assert.ok(db.prepare('SELECT token FROM auth_challenges WHERE token = ?').get(sha256(challenge)));
  assert.equal(db.prepare('SELECT token FROM auth_challenges WHERE token = ?').get(challenge), undefined);
  const factor = totp(secret).generate({ timestamp: now });
  assert.equal((await browser.request('/auth/login/verify', { factor })).status, 200);
  assert.equal((await browser.request('/protected')).status, 200);
  assert.equal((await browser.request('/auth/login/verify', { factor })).status, 401);
  const other = new Browser();
  await other.login();
  assert.equal((await other.request('/auth/login/verify', { factor })).status, 401);
  const session = browser.cookies.get('fv_session')!;
  assert.ok(db.prepare('SELECT token FROM sessions WHERE token = ?').get(sha256(session)));
  await browser.request('/auth/logout', {});
  assert.equal((await browser.request('/protected')).status, 401);
});

test('recovery codes are consumed atomically, work only after password, and never disable 2FA', async () => {
  const { browser, codes } = await enabled();
  const anonymous = new Browser();
  assert.equal((await anonymous.request('/auth/login/verify', { factor: codes[0] })).status, 401);
  const a = new Browser();
  const b = new Browser();
  await Promise.all([a.login(), b.login()]);
  const results = await Promise.all([
    a.request('/auth/login/verify', { factor: codes[0]!.toLowerCase().replaceAll('-', ' ') }),
    b.request('/auth/login/verify', { factor: codes[0] }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 401]);
  const status = (await browser.request('/auth/status')).body;
  assert.equal(status.twoFactor, true);
  assert.equal(status.recoveryCodesRemaining, 9);
});

test('login challenges expire, are consumed once, and stop after five bad codes across IPs', async () => {
  const { secret, codes } = await enabled();
  const expired = new Browser();
  await expired.login();
  db.prepare("UPDATE auth_challenges SET expires_at = ? WHERE kind = 'login'").run(now);
  assert.equal((await expired.request('/auth/login/verify', { factor: codes[0] })).status, 401);
  const browser = new Browser();
  await browser.login();
  for (let i = 0; i < 5; i++) assert.equal((await browser.request('/auth/login/verify', { factor: 'invalid' }, crypto.randomUUID())).status, 401);
  assert.equal((await browser.request('/auth/login/verify', { factor: totp(secret).generate({ timestamp: now }) })).status, 401);
  assert.equal((await browser.request('/protected')).status, 401);
});

test('IP throttling applies to password attempts and cannot be reset by passing only the password with 2FA', async () => {
  await enabled();
  const browser = new Browser();
  for (let i = 0; i < 4; i++) assert.equal((await browser.request('/auth/login', { email, password: 'wrong' })).status, 401);
  assert.equal((await browser.login()).status, 200);
  assert.equal((await browser.request('/auth/login/verify', { factor: 'wrong' })).status, 401);
  assert.equal((await browser.login()).status, 429);
});

test('parallel password attempts are not checked more often than sequential ones', async () => {
  await configured();
  const ip = crypto.randomUUID();
  const burst = await Promise.all(Array.from({ length: 20 }, (_, i) => new Browser().request('/auth/login', { email, password: `wrong-${i}` }, ip)));
  let checked = burst.filter((r) => r.status === 401).length;
  assert.ok(checked >= 1 && checked <= 5, `${checked} parallel attempts were checked`);
  assert.equal(burst.filter((r) => r.status === 429).length, 20 - checked);
  // Falls nicht alle fünf gleichzeitig ankamen: nacheinander auffüllen. Insgesamt bleibt es bei fünf Prüfungen.
  for (; checked < 5; checked++) assert.equal((await new Browser().request('/auth/login', { email, password: 'wrong' }, ip)).status, 401);
  assert.equal((await new Browser().request('/auth/login', { email, password }, ip)).status, 429);
});

test('IPv6 attempts count per /64 network', async () => {
  await configured();
  for (let i = 1; i <= 5; i++) {
    assert.equal((await new Browser().request('/auth/login', { email, password: 'wrong' }, `2001:db8:aa:1::${i}`)).status, 401);
  }
  assert.equal((await new Browser().request('/auth/login', { email, password }, '2001:db8:aa:1:ffff:ffff:ffff:ffff')).status, 429);
  assert.equal((await new Browser().request('/auth/login', { email, password }, '2001:db8:aa:2::1')).status, 200);
});

test('throttle keys group IPv6 by /64 and unwrap IPv4-mapped addresses', () => {
  assert.equal(addressKey('2001:db8:1:2::1'), '2001:0db8:0001:0002::/64');
  assert.equal(addressKey('2001:0db8:0001:0002:ffff:0:0:9'), addressKey('2001:db8:1:2::1'));
  assert.notEqual(addressKey('2001:db8:1:3::1'), addressKey('2001:db8:1:2::1'));
  assert.equal(addressKey('fe80::1%eth0'), addressKey('fe80::2'));
  assert.equal(addressKey('::1'), '0000:0000:0000:0000::/64');
  assert.equal(addressKey('64:ff9b::192.0.2.7'), '0064:ff9b:0000:0000::/64');
  assert.equal(addressKey('::ffff:192.0.2.7'), '192.0.2.7');
  assert.equal(addressKey('::ffff:c000:207'), '192.0.2.7');
  assert.equal(addressKey('192.0.2.7'), '192.0.2.7');
  assert.equal(addressKey('unknown'), 'unknown');
});

test('throttle counts running checks and allows only one check at a time after a lock', (t) => {
  let clock = now;
  t.mock.method(Date, 'now', () => clock);
  const throttle = createLoginThrottle({ globalLimit: 10_000 });
  const running = Array.from({ length: 5 }, () => {
    assert.equal(throttle.wait('a'), 0);
    return throttle.begin('a');
  });
  assert.equal(throttle.wait('a'), 1);
  assert.equal(throttle.wait('b'), 0);
  // Ein Versuch ohne Ergebnis (z. B. ungültige Eingabe) gibt seinen Platz wieder frei
  running.pop()!();
  assert.equal(throttle.wait('a'), 0);
  running.push(throttle.begin('a'));
  for (const release of running) {
    throttle.failed('a');
    release();
    release();
  }
  assert.equal(throttle.wait('a'), 60);
  clock += 60_000;
  assert.equal(throttle.wait('a'), 0);
  const single = throttle.begin('a');
  assert.equal(throttle.wait('a'), 1);
  throttle.failed('a');
  single();
  assert.equal(throttle.wait('a'), 120);
  // Erfolg setzt die Adresse zurück
  clock += 120_000;
  throttle.succeeded('a');
  assert.equal(throttle.wait('a'), 0);
});

test('throttle brakes failures and parallel checks across all addresses', (t) => {
  let clock = now;
  t.mock.method(Date, 'now', () => clock);
  const global = createLoginThrottle({ globalLimit: 3, globalWindow: 60_000 });
  global.failed('x');
  global.failed('y');
  const running = global.begin('z');
  // Zwei Fehlversuche plus eine laufende Prüfung erreichen die Grenze
  assert.equal(global.wait('fresh'), 1);
  global.failed('z');
  running();
  assert.equal(global.wait('fresh'), 60);
  global.succeeded('x');
  assert.equal(global.wait('x'), 60);
  clock += 30_000;
  assert.equal(global.wait('fresh'), 30);
  clock += 30_000;
  assert.equal(global.wait('fresh'), 0);

  const capped = createLoginThrottle({ maxPending: 2 });
  const first = capped.begin('p');
  capped.begin('q');
  assert.equal(capped.wait('r'), 1);
  first();
  assert.equal(capped.wait('r'), 0);
  // Eine nie abgemeldete Prüfung verfällt und sperrt nicht dauerhaft
  capped.begin('r');
  assert.equal(capped.wait('s'), 1);
  clock += 2 * 60_000 + 1;
  assert.equal(capped.wait('s'), 0);
});

test('expired and cancelled enrollment cannot enable 2FA; repeated bad codes also invalidate it', async () => {
  const browser = await configured();
  let setup = await browser.request('/auth/2fa/setup', { current: password });
  db.prepare('UPDATE auth_challenges SET expires_at = ?').run(now);
  assert.equal((await browser.request('/auth/2fa/enable', { factor: totp(setup.body.secret).generate({ timestamp: now }) })).status, 400);
  setup = await browser.request('/auth/2fa/setup', { current: password });
  assert.equal((await browser.request('/auth/2fa/cancel', {})).status, 200);
  assert.equal((await browser.request('/auth/2fa/enable', { factor: totp(setup.body.secret).generate({ timestamp: now }) })).status, 400);
  setup = await browser.request('/auth/2fa/setup', { current: password });
  for (let i = 0; i < 5; i++) assert.equal((await browser.request('/auth/2fa/enable', { factor: 'wrong' }, crypto.randomUUID())).status, 400);
  assert.equal((await browser.request('/auth/2fa/enable', { factor: totp(setup.body.secret).generate({ timestamp: now }) })).status, 400);
});

test('security changes require password and fresh factor, revoke all other sessions and pending logins', async () => {
  const { browser, codes } = await enabled();
  const other = new Browser();
  await other.login();
  await other.request('/auth/login/verify', { factor: codes[0] });
  const pending = new Browser();
  await pending.login();
  assert.equal((await browser.request('/auth/email', { email: 'new@example.com', current: password })).status, 401);
  assert.equal((await browser.request('/auth/password', { current: password, next: 'new-password' })).status, 401);
  assert.equal((await browser.request('/auth/2fa/disable', { current: password })).status, 401);
  assert.equal((await browser.request('/auth/2fa/recovery', { current: 'wrong', factor: codes[1] })).status, 401);
  const regenerated = await browser.request('/auth/2fa/recovery', { current: password, factor: codes[1] });
  assert.equal(regenerated.status, 200);
  assert.equal(regenerated.body.codes.length, 10);
  assert.equal((await other.request('/protected')).status, 401);
  assert.equal((await pending.request('/auth/login/verify', { factor: codes[2] })).status, 401);
  const fresh = new Browser();
  await fresh.login();
  assert.equal((await fresh.request('/auth/login/verify', { factor: codes[2] })).status, 401);
  const newCodes = regenerated.body.codes;
  assert.equal((await browser.request('/auth/email', { email: 'new@example.com', current: password, factor: newCodes[0] })).status, 200);
  assert.equal((await browser.request('/auth/password', { current: password, next: 'new-password', factor: newCodes[1] })).status, 200);
  assert.equal((await browser.request('/auth/2fa/disable', { current: 'new-password', factor: newCodes[2] })).status, 200);
  assert.equal((await browser.request('/auth/status')).body.twoFactor, false);
  assert.equal(getSetting('admin_totp_secret'), undefined);
  const login = await new Browser().request('/auth/login', { email: 'new@example.com', password: 'new-password' });
  assert.deepEqual(login.body, { ok: true });
});

test('environment-managed credentials retain 2FA and cannot be changed through the API', async () => {
  process.env.ADMIN_PASSWORD = password;
  process.env.ADMIN_EMAIL = 'ADMIN@EXAMPLE.COM';
  const browser = new Browser();
  assert.equal((await browser.login()).status, 200);
  assert.equal((await browser.request('/auth/status')).body.envEmail, true);
  assert.equal((await browser.request('/auth/password', { current: password, next: 'new-password' })).status, 400);
  assert.equal((await browser.request('/auth/email', { current: password, email: 'new@example.com' })).status, 400);
  const setup = await browser.request('/auth/2fa/setup', { current: password });
  assert.equal((await browser.request('/auth/2fa/enable', { factor: totp(setup.body.secret).generate({ timestamp: now }) })).status, 200);
  assert.deepEqual((await new Browser().login()).body, { twoFactorRequired: true });
});

test('concurrent credential changes cannot reuse an invalidated session', async () => {
  const browser = await configured();
  const results = await Promise.all([
    browser.request('/auth/email', { email: 'first@example.com', current: password }),
    browser.request('/auth/email', { email: 'second@example.com', current: password }),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 401]);
  const winner = results[0]!.status === 200 ? 'first@example.com' : 'second@example.com';
  assert.equal(getSetting('admin_email'), winner);
});

test('recovery codes still allow login and resetting 2FA if the encryption key is lost', async () => {
  const { codes } = await enabled();
  // Simulate a TOTP secret that cannot be decrypted with the current installation key.
  setSetting('admin_totp_secret', 'unreadable');
  const browser = new Browser();
  await browser.login();
  assert.equal((await browser.request('/auth/login/verify', { factor: codes[0] })).status, 200);
  assert.equal((await browser.request('/auth/2fa/disable', { current: password, factor: codes[1] })).status, 200);
  assert.equal((await browser.request('/auth/status')).body.twoFactor, false);
});

test('deployment triggers require a full admin session, password and a fresh second factor', async () => {
  const { browser, secret, codes } = await enabled();
  const anonymous = new Browser();
  assert.equal((await anonymous.request('/auth/update', { current: password, factor: codes[0] })).status, 401);
  await anonymous.login();
  assert.equal((await anonymous.request('/auth/update', { current: password, factor: codes[0] })).status, 401);
  assert.equal((await browser.request('/auth/update', { current: 'wrong', factor: codes[0] })).status, 401);
  assert.equal((await browser.request('/auth/update', { current: password })).status, 401);
  assert.equal((await browser.request('/auth/update', { current: password, factor: totp(secret).generate({ timestamp: now - 30_000 }) })).status, 401);
  assert.equal(updateCalls, 0);
  const response = await browser.request('/auth/update', { current: password, factor: codes[0], url: 'https://attacker.example.test' });
  assert.equal(response.status, 202);
  assert.equal(response.body.status, 'accepted');
  assert.equal(updateCalls, 1);
  assert.equal(updateBody.includes(password), false);
  assert.equal(updateBody.includes(codes[0]!), false);
  assert.equal(updateBody.includes('attacker'), false);
  assert.equal((await browser.request('/auth/status')).body.recoveryCodesRemaining, 9);
  assert.equal((await browser.request('/auth/update', { current: password, factor: codes[1] })).status, 429);
  assert.equal(updateCalls, 1);
});

test('TOTP accepts limited clock drift, rejects replay/old codes, and matches an RFC 6238 vector', () => {
  // RFC SHA-1 secret "12345678901234567890", six-digit truncation of 94287082 at t=59.
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.equal(totp(secret).generate({ timestamp: 59_000 }), '287082');
  assert.equal(totpCounter(secret, '287082', -1, 59_000), 1);
  assert.equal(totpCounter(secret, '287082', 1, 59_000), null);
  assert.equal(totpCounter(secret, '287082', -1, 89_000), 1);
  assert.equal(totpCounter(secret, '287082', -1, 119_000), null);
  assert.equal(totpCounter(secret, 'not-a-code', -1, 59_000), null);
});

test('dashboard preferences require a full session for reads and writes', async () => {
  const anonymous = new Browser();
  assert.equal((await anonymous.request('/dashboard/layout')).status, 401);
  assert.equal((await anonymous.put('/dashboard/layout', defaultDashboardLayout())).status, 401);
  assert.equal((await anonymous.patch('/dashboard/layout/order', { order: [] })).status, 401);
  assert.equal((await anonymous.patch('/dashboard/layout/geometry', { order: [], sizes: {} })).status, 401);
  await enabled();
  const pending = new Browser();
  assert.equal((await pending.login()).body.twoFactorRequired, true);
  assert.equal((await pending.request('/dashboard/layout')).status, 401);
  assert.equal((await pending.put('/dashboard/layout', defaultDashboardLayout())).status, 401);
  assert.equal((await pending.patch('/dashboard/layout/order', { order: [] })).status, 401);
  assert.equal((await pending.patch('/dashboard/layout/geometry', { order: [], sizes: {} })).status, 401);
});

test('dashboard defaults, hidden widgets and reset persist across admin sessions', async () => {
  const browser = await configured();
  const defaults = defaultDashboardLayout();
  assert.deepEqual((await browser.request('/dashboard/layout')).body, defaults);
  const layout = defaultDashboardLayout();
  for (const widget of Object.values(layout.widgets)) widget.visible = false;
  assert.equal((await browser.put('/dashboard/layout', layout)).status, 200);
  assert.deepEqual(JSON.parse(getSetting('admin_dashboard_layout')!), layout);
  await browser.request('/auth/logout', {});
  const secondDevice = new Browser();
  assert.equal((await secondDevice.login()).status, 200);
  assert.deepEqual((await secondDevice.request('/dashboard/layout')).body, layout);
  assert.deepEqual((await secondDevice.put('/dashboard/layout', defaults)).body, defaults);
  assert.deepEqual((await secondDevice.request('/dashboard/layout')).body, defaults);
});

test('malformed dashboard writes do not overwrite the saved layout', async () => {
  const browser = await configured();
  const layout = defaultDashboardLayout();
  layout.widgets.history.visible = false;
  await browser.put('/dashboard/layout', layout);
  for (const invalid of [null, [], {}, { ...layout, version: 2 },
    { ...layout, widgets: { history: { visible: 'false' } } },
    { ...layout, widgets: { unknown: { visible: false } } },
    { ...layout, widgets: { history: { visible: false, unexpected: 1 } } },
    { ...layout, unexpected: true }]) {
    assert.equal((await browser.put('/dashboard/layout', invalid)).status, 400);
    assert.deepEqual((await browser.request('/dashboard/layout')).body, layout);
  }
});

test('old and corrupt saved dashboard layouts get safe defaults for new widgets', async () => {
  const browser = await configured();
  const expected = defaultDashboardLayout();
  expected.widgets.history.visible = false;
  const legacy = { version: 1, widgets: { history: { visible: false }, retired: { visible: false } } };
  setSetting('admin_dashboard_layout', JSON.stringify(legacy));
  assert.deepEqual((await browser.request('/dashboard/layout')).body, expected);
  assert.deepEqual((await browser.put('/dashboard/layout', { version: 1, widgets: { history: { visible: false } } })).body, expected);
  for (const corrupt of ['not json', 'null', '{"version":2,"widgets":{}}']) {
    setSetting('admin_dashboard_layout', corrupt);
    assert.deepEqual((await browser.request('/dashboard/layout')).body, defaultDashboardLayout());
  }
});

test('direct widget hiding persists across devices without replacing other widget choices', async () => {
  const path = '/dashboard/layout/widgets/history';
  assert.equal((await new Browser().patch(path, { visible: false })).status, 401);
  const browser = await configured();
  const other = new Browser();
  await other.login();
  const first = await browser.patch(path, { visible: false });
  assert.equal(first.status, 200);
  assert.equal(first.body.widgets.history.visible, false);
  const second = await other.patch('/dashboard/layout/widgets/instances', { visible: false });
  assert.equal(second.status, 200);
  assert.equal(second.body.widgets.history.visible, false);
  assert.equal(second.body.widgets.instances.visible, false);
  assert.equal(second.body.widgets.executions.visible, true);
  const restored = await browser.patch(path, { visible: true });
  assert.equal(restored.body.widgets.history.visible, true);
  assert.equal(restored.body.widgets.instances.visible, false);
  assert.deepEqual((await other.request('/dashboard/layout')).body, restored.body);
  assert.deepEqual(JSON.parse(getSetting('admin_dashboard_layout')!), restored.body);
});

test('invalid widget visibility changes cannot overwrite saved preferences', async () => {
  const browser = await configured();
  await browser.patch('/dashboard/layout/widgets/executions', { visible: false });
  const before = (await browser.request('/dashboard/layout')).body;
  for (const invalid of [null, [], {}, { visible: 'false' }, { visible: 0 }, { visible: true, extra: 'ignored?' }]) {
    assert.equal((await browser.patch('/dashboard/layout/widgets/executions', invalid)).status, 400);
    assert.deepEqual((await browser.request('/dashboard/layout')).body, before);
  }
  for (const unknown of ['unknown', '__proto__', 'constructor']) {
    assert.equal((await browser.patch(`/dashboard/layout/widgets/${unknown}`, { visible: false })).status, 400);
    assert.deepEqual((await browser.request('/dashboard/layout')).body, before);
  }
});

test('widget order persists across devices and is independent of visibility updates and older clients', async () => {
  const browser = await configured();
  const order = [...defaultDashboardLayout().order].reverse();
  await browser.patch('/dashboard/layout/widgets/history', { visible: false });
  const response = await browser.patch('/dashboard/layout/order', { order });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.order, order);
  assert.equal(response.body.widgets.history.visible, false);
  const second = new Browser();
  await second.login();
  assert.deepEqual((await second.request('/dashboard/layout')).body.order, order);
  await second.patch('/dashboard/layout/widgets/executions', { visible: false });
  assert.deepEqual((await browser.request('/dashboard/layout')).body.order, order);
  const legacy = { version: 1, widgets: { storage: { visible: false } } };
  const changed = await browser.put('/dashboard/layout', legacy);
  assert.deepEqual(changed.body.order, order);
  assert.equal(changed.body.widgets.storage.visible, false);
  const reset = await second.put('/dashboard/layout', defaultDashboardLayout());
  assert.deepEqual(reset.body, defaultDashboardLayout());
});

test('invalid order writes preserve the saved layout; partial orders append missing widgets', async () => {
  const browser = await configured();
  const before = (await browser.request('/dashboard/layout')).body;
  for (const body of [null, [], {}, { order: null }, { order: 'history' }, { order: ['history', 'history'] },
    { order: ['unknown'] }, { order: [1] }, { order: [], widgets: {} }]) {
    assert.equal((await browser.patch('/dashboard/layout/order', body)).status, 400);
    assert.deepEqual((await browser.request('/dashboard/layout')).body, before);
  }
  const response = await browser.patch('/dashboard/layout/order', { order: ['instances'] });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.order, ['instances', ...before.order.filter((id: string) => id !== 'instances')]);
  assert.deepEqual(JSON.parse(getSetting('admin_dashboard_layout')!).order, response.body.order);
});

test('widget resizing persists together with order and survives visibility changes and legacy clients', async () => {
  const browser = await configured();
  const order = [...defaultDashboardLayout().order].reverse();
  await browser.patch('/dashboard/layout/widgets/instances', { visible: false });
  const changed = await browser.patch('/dashboard/layout/geometry', { order, sizes: { history: { columns: 12, height: 400 } } });
  assert.equal(changed.status, 200);
  assert.deepEqual(changed.body.order, order);
  assert.deepEqual(changed.body.sizes.history, { columns: 12, height: 400 });
  assert.equal(changed.body.widgets.instances.visible, false);
  assert.deepEqual(changed.body.sizes.executions, { columns: 6, height: null });
  const other = new Browser();
  await other.login();
  assert.deepEqual((await other.request('/dashboard/layout')).body, changed.body);
  await other.patch('/dashboard/layout/widgets/history', { visible: false });
  await other.patch('/dashboard/layout/widgets/history', { visible: true });
  assert.deepEqual((await browser.request('/dashboard/layout')).body.sizes.history, { columns: 12, height: 400 });
  const legacy = await browser.put('/dashboard/layout', { version: 1, widgets: {} });
  assert.deepEqual(legacy.body.sizes, changed.body.sizes);
  await browser.patch('/dashboard/layout/order', { order: [] });
  assert.deepEqual((await browser.request('/dashboard/layout')).body.sizes, changed.body.sizes);
  const reset = await browser.put('/dashboard/layout', defaultDashboardLayout());
  assert.deepEqual(reset.body, defaultDashboardLayout());
});

test('invalid geometry writes are atomic and do not overwrite the stored arrangement', async () => {
  const browser = await configured();
  const before = (await browser.request('/dashboard/layout')).body;
  for (const body of [null, {}, { order: [] }, { order: [], sizes: null }, { order: [], sizes: [] },
    { order: [], sizes: { unknown: { columns: 6, height: null } } },
    { order: [], sizes: { history: { columns: 0, height: 300 } } },
    { order: [], sizes: { history: { columns: 6, height: -1 } } },
    { order: [], sizes: { history: { columns: 6, height: 999999 } } },
    { order: ['history', 'history'], sizes: {} }, { order: [], sizes: {}, extra: true }]) {
    assert.equal((await browser.patch('/dashboard/layout/geometry', body)).status, 400);
    assert.deepEqual((await browser.request('/dashboard/layout')).body, before);
  }
});
