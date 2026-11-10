import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Snapshot } from '../shared/diff.ts';

// ai.ts öffnet beim Import die Datenbank – nie die der Installation.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flowvault-ai-'));
const savedDataDir = process.env.DATA_DIR;
process.env.DATA_DIR = directory;
const { buildPrompt, isSecretName, redact } = await import('./ai.ts');
const { db } = await import('./db.ts');
const { diffWorkflows } = await import('../shared/diff.ts');
after(() => {
  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
  if (savedDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = savedDataDir;
});

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const HEX = '0123456789abcdef';
const DIGITS = '0123456789';

/**
 * Erfundene, zufällig wirkende Werte. Sie entstehen erst zur Laufzeit, damit Secret-Scanner sie im
 * Quelltext nicht für echte Schlüssel halten. Fester Startwert: Der Test läuft jedes Mal gleich.
 */
function fake(length: number, alphabet = BASE62, seed = 1) {
  let state = seed;
  let out = '';
  for (let i = 0; i < length; i++) {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    out += alphabet[((t ^ (t >>> 14)) >>> 0) % alphabet.length];
  }
  return out;
}

const text = (value: unknown) => JSON.stringify(redact(value));

test('credentials in URLs and webhook addresses are removed, ordinary URLs stay', () => {
  const secret = fake(16);
  assert.equal(redact(`postgres://app_user:${secret}@db.internal:5432/crm`), 'postgres://[redacted]@db.internal:5432/crm');
  assert.equal(redact(`https://${fake(40, HEX)}@git.example.com/repo.git`), 'https://[redacted]@git.example.com/repo.git');
  assert.equal(
    redact(`https://hooks.slack.com/services/T${fake(10, DIGITS)}/B${fake(10, DIGITS, 2)}/${fake(24, BASE62, 3)}`),
    'https://hooks.slack.com/[redacted]',
  );
  assert.equal(
    redact(`https://discord.com/api/webhooks/${fake(18, DIGITS)}/${fake(68, BASE62, 4)}`),
    'https://discord.com/api/webhooks/[redacted]',
  );
  const bot = `${fake(10, DIGITS, 5)}:${fake(35, BASE62, 6)}`;
  assert.equal(redact(`https://api.telegram.org/bot${bot}/sendMessage`), 'https://api.telegram.org/[redacted]/sendMessage');
  assert.equal(redact(`token ist ${bot}`), 'token ist [redacted]');

  for (const plain of [
    'https://api.example.com/v1/customers?limit=100&page=2',
    'https://example.com/contact?email=team@example.com',
    'mailto:team@example.com',
    'Bitte an support@example.com schreiben',
  ]) assert.equal(redact(plain), plain);
});

test('header, query and field names mark their values as secret, ordinary names do not', () => {
  for (const name of ['X-Custom-Auth', 'key', 'clientKey', 'hmacSig', 'X-Api-Key', 'password', 'apitoken', 'basicAuth', 'otp']) {
    assert.equal(isSecretName(name), true, name);
  }
  for (const name of ['authentication', 'genericAuthType', 'nodeCredentialType', 'credentials', 'name', 'value', 'url', 'keys', 'monkey', 'headerParameters']) {
    assert.equal(isSecretName(name), false, name);
  }
  const value = fake(19, 'abcdefghijklmnopqrstuvwxyz0123456789');
  const params = {
    headerParameters: { parameters: [{ name: 'X-Custom-Auth', value }, { name: 'Accept', value: 'application/json' }] },
    queryParameters: { parameters: [{ name: 'key', value }] },
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
  };
  const out = text(params);
  assert.equal(out.includes(value), false);
  for (const kept of ['application/json', 'genericCredentialType', 'httpHeaderAuth', 'X-Custom-Auth']) assert.ok(out.includes(kept), kept);
});

test('random-looking constants are removed; words, paths, expressions and IDs stay', () => {
  assert.equal(redact(`const k = "${fake(32, HEX)}";`), 'const k = "[redacted]";');
  assert.equal(redact(`pat-na1-${fake(8, HEX)}-${fake(4, HEX, 2)}-${fake(4, HEX, 3)}-${fake(4, HEX, 4)}-${fake(12, HEX, 5)}`), '[redacted]');
  // Base64 mit „/“: kein Teil ist allein lang genug, die ganze Folge schon
  assert.equal(redact(`${fake(13, BASE62, 7)}/${fake(7, BASE62, 8)}/${fake(18, BASE62, 9)}`), '[redacted]');

  // Heuristik: Fast alle Zufallswerte ab 24 Zeichen fallen auf
  const share = (alphabet: string) => {
    const samples = Array.from({ length: 300 }, (_, i) => fake(32, alphabet, 100 + i));
    return samples.filter((s) => redact(s) === '[redacted]').length / samples.length;
  };
  assert.ok(share(BASE62) >= 0.9, `base62 ${share(BASE62)}`);
  assert.ok(share('abcdefghijklmnopqrstuvwxyz0123456789') >= 0.95);
  assert.equal(share(HEX), 1);

  for (const plain of [
    '={{ $json.customerId }}',
    "={{ $('Webhook').item.json.body.orderNumber }}",
    '/webhook/order-created/2024/v2/production-handler',
    'Wf3kL9mQ2xR7tY1z',
    'convertToBase64String',
    'OAuth2ClientCredentials',
    'XMLHttpRequestHandler',
    '2024-01-15T10:30:00.000Z',
    'Benachrichtigungseinstellungen2024',
    'customer_lifetime_value_2024_q3',
    '@n8n/n8n-nodes-langchain.agent',
    'claude-sonnet-4-20250514',
    'return items.map(i => ({ json: { ...i.json, processedAt: new Date().toISOString() } }));',
    'SELECT customer_id, order_total FROM orders_2024 WHERE created_at > NOW()',
    'Sende eine Nachricht an den Vertrieb, wenn ein neuer Lead aus dem Webformular kommt',
  ]) assert.equal(redact(plain), plain);
});

test('existing key formats and assignments are still removed', () => {
  assert.equal(redact(`Authorization: Bearer ${fake(24)}`), 'Authorization: [redacted]');
  assert.equal(redact('password = "hunter2hunter2"'), 'password = "[redacted]"');
  assert.equal(text({ name: 'X-API-Key', value: 'abc' }), '{"name":"X-API-Key","value":"[redacted]"}');
  assert.equal(text({ apiKey: 'abc', url: 'https://api.example.com' }), '{"apiKey":"[redacted]","url":"https://api.example.com"}');
});

test('changed secret fields are not sent to the AI, even as bare values', () => {
  const snapshot = (parameters: Record<string, unknown>): Snapshot => ({
    n8nId: 'w1', name: 'Login', active: false, connections: {}, settings: {}, pinData: null, staticData: null, tags: [],
    nodes: [{ id: 'n1', name: 'Anmelden', type: 'n8n-nodes-base.httpRequest', typeVersion: 4, position: [0, 0], parameters }],
  });
  const before = snapshot({ url: 'https://api.example.com/login', password: 'Alt-Passwort-1', clientKey: 'abc' });
  const after = snapshot({ url: 'https://api.example.com/v2/login', password: 'Neu-Passwort-2', clientKey: 'def' });
  const prompt = buildPrompt(before, after, diffWorkflows(before, after));
  for (const leaked of ['Alt-Passwort-1', 'Neu-Passwort-2', '"abc"', '"def"']) assert.equal(prompt.includes(leaked), false, leaked);
  assert.ok(prompt.includes('parameters.password: "[redacted]" → "[redacted]"'));
  assert.ok(prompt.includes('parameters.url: "https://api.example.com/login" → "https://api.example.com/v2/login"'));
});
