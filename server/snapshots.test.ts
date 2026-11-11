import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, mock, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import type { N8nWorkflow } from './n8n.ts';
import type { Snapshot } from '../shared/diff.ts';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flowvault-snapshots-'));
const savedEnv = { DATA_DIR: process.env.DATA_DIR, APP_SECRET: process.env.APP_SECRET };
process.env.DATA_DIR = directory;
process.env.APP_SECRET = 'test-only-snapshot-encryption-key';
const { db, getSetting, setSetting } = await import('./db.ts');
const { decrypt, encrypt, isEncryptedSnapshot, pack, unpack } = await import('./crypto.ts');
const { migrateSnapshots } = await import('./snapshot-migration.ts');
const { getInstance, loadSnapshot, recordWorkflow, restoreVersion } = await import('./sync.ts');
const { N8nClient } = await import('./n8n.ts');
const STATE_KEY = 'snapshot_encryption_v1';

const workflow = (credential: string, token: string): N8nWorkflow => ({
  id: 'test-workflow', name: 'Secret test', active: false,
  nodes: [{ id: 'http', name: 'HTTP', type: 'n8n-nodes-base.httpRequest',
    parameters: { url: 'https://example.test', headerParameters: { parameters: [{ name: 'Authorization', value: `Bearer ${token}` }] } },
    credentials: { httpHeaderAuth: { id: credential, name: `Credential ${credential}` } },
  }],
  connections: {}, settings: {}, pinData: { HTTP: [{ json: { private: 'personal-test-data' } }] },
  staticData: { token: 'static-test-secret' },
});

function seed() {
  const instanceId = Number(db.prepare('INSERT INTO instances (name, base_url, api_key_enc, created_at) VALUES (?, ?, ?, ?)')
    .run('Test', 'http://n8n.test', encrypt('test-n8n-key'), Date.now()).lastInsertRowid);
  const instance = getInstance(instanceId)!;
  recordWorkflow(instance, workflow('A', 'old-inline-test-secret'));
  recordWorkflow(instance, workflow('B', 'new-inline-test-secret'));
  const rows = db.prepare('SELECT id, snapshot FROM versions ORDER BY id').all() as { id: number; snapshot: Uint8Array }[];
  return { instance, rows };
}

function makeLegacy(id: number) {
  const snapshot = loadSnapshot(id)!;
  const legacy = gzipSync(JSON.stringify(snapshot));
  db.prepare('UPDATE versions SET snapshot = ? WHERE id = ?').run(legacy, id);
  return { snapshot, legacy };
}

beforeEach(() => {
  db.exec('DELETE FROM instances; DELETE FROM settings;');
});
afterEach(() => mock.restoreAll());
after(() => {
  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('new snapshots encrypt all workflow data with independent nonces and stay losslessly readable', () => {
  const value = workflow('A', 'inline-test-secret');
  const first = Buffer.from(pack(value));
  const second = Buffer.from(pack(value));
  assert.ok(isEncryptedSnapshot(first));
  assert.notDeepEqual(first, second);
  assert.equal(first.includes(Buffer.from('inline-test-secret')), false);
  assert.throws(() => gunzipSync(first));
  assert.deepEqual(unpack(first), value);
  assert.deepEqual(unpack(second), value);
});

test('tampered header, version, nonce, tag, ciphertext and truncated snapshots are rejected', () => {
  const original = Buffer.from(pack(workflow('A', 'inline-test-secret')));
  for (const position of [0, 4, 5, 17, 33, original.length - 1]) {
    const changed = Buffer.from(original);
    changed[position] ^= 1;
    assert.throws(() => unpack(changed), `tampering at byte ${position}`);
  }
  for (const length of [0, 4, 5, 17, 33, original.length - 1]) {
    assert.throws(() => unpack(original.subarray(0, length)), `truncation at ${length}`);
  }
  assert.throws(() => unpack(Buffer.from('{"token":"plaintext"}')));
});

test('legacy gzip remains readable for the migration', () => {
  const value = workflow('A', 'legacy-inline-test-secret');
  const legacy = gzipSync(JSON.stringify(value));
  assert.equal(isEncryptedSnapshot(legacy), false);
  assert.throws(() => unpack(legacy), 'normal reads must not fall back to unencrypted data');
  assert.deepEqual(unpack(legacy, { allowLegacy: true }), value);
});

test('startup migrates mixed history, preserves metadata and cleans old database and WAL contents', () => {
  const { rows } = seed();
  const { snapshot, legacy } = makeLegacy(rows[0]!.id);
  const metadata = db.prepare('SELECT id, workflow_id, number, hash, summary, created_at FROM versions ORDER BY id').all();
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const filename = path.join(directory, 'flowvault.db');
  assert.ok(fs.readFileSync(filename).includes(legacy), 'fixture contains the old unencrypted blob');

  assert.equal(migrateSnapshots(), 1);
  assert.equal(decrypt(getSetting(STATE_KEY)!), 'ready');
  const after = db.prepare('SELECT id, snapshot FROM versions ORDER BY id').all() as { id: number; snapshot: Uint8Array }[];
  assert.ok(after.every((r) => isEncryptedSnapshot(r.snapshot)));
  assert.deepEqual(loadSnapshot(rows[0]!.id), snapshot);
  assert.deepEqual(after[1]!.snapshot, rows[1]!.snapshot, 'already encrypted snapshots are not rewritten');
  assert.deepEqual(db.prepare('SELECT id, workflow_id, number, hash, summary, created_at FROM versions ORDER BY id').all(), metadata);
  assert.equal(fs.readFileSync(filename).includes(legacy), false);
  assert.equal(fs.readFileSync(`${filename}-wal`).includes(legacy), false);
  assert.equal(migrateSnapshots(), 0, 'migration is idempotent');
  const unchanged = db.prepare('SELECT snapshot FROM versions ORDER BY id').all() as { snapshot: Uint8Array }[];
  assert.deepEqual(unchanged.map((r) => r.snapshot), after.map((r) => r.snapshot));
});

test('migration processes histories larger than one page without skipping versions', () => {
  const { rows } = seed();
  const { legacy } = makeLegacy(rows[0]!.id);
  const row = db.prepare('SELECT workflow_id, hash, summary FROM versions WHERE id = ?').get(rows[0]!.id)!;
  const insert = db.prepare('INSERT INTO versions (workflow_id, number, hash, snapshot, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  for (let number = 3; number <= 105; number++) insert.run(row.workflow_id!, number, row.hash!, legacy, row.summary!, number);
  assert.equal(migrateSnapshots(), 104);
  const all = db.prepare('SELECT snapshot FROM versions').all() as { snapshot: Uint8Array }[];
  assert.equal(all.length, 105);
  assert.ok(all.every((r) => isEncryptedSnapshot(r.snapshot)));
});

test('an unreadable version rolls back all changes and leaves legacy history intact', () => {
  const { rows } = seed();
  const { legacy } = makeLegacy(rows[0]!.id);
  db.prepare('UPDATE versions SET snapshot = ? WHERE id = ?').run(Buffer.from('broken snapshot'), rows[1]!.id);
  assert.throws(() => migrateSnapshots(), /zurückgerollt|rolled back/);
  const stored = db.prepare('SELECT snapshot FROM versions WHERE id = ?').get(rows[0]!.id) as { snapshot: Uint8Array };
  assert.deepEqual(Buffer.from(stored.snapshot), legacy);
  assert.equal(getSetting(STATE_KEY), undefined);
});

test('a changed key is rejected before migrating legacy data', () => {
  const { rows, instance } = seed();
  const { legacy } = makeLegacy(rows[0]!.id);
  db.prepare('UPDATE instances SET api_key_enc = ? WHERE id = ?').run('unreadable-with-current-key', instance.id);
  assert.throws(() => migrateSnapshots(), /Anwendungsschlüssel|application key/);
  const row = db.prepare('SELECT snapshot FROM versions WHERE id = ?').get(rows[0]!.id) as { snapshot: Uint8Array };
  assert.deepEqual(Buffer.from(row.snapshot), legacy);
  assert.equal(getSetting(STATE_KEY), undefined);
});

test('interrupted cleanup is persisted and retried without encrypting the versions again', () => {
  const { rows } = seed();
  makeLegacy(rows[0]!.id);
  const exec = db.exec.bind(db);
  const failure = mock.method(db, 'exec', (sql: string) => {
    if (sql === 'VACUUM') throw new Error('simulated disk full');
    return exec(sql);
  });
  assert.throws(() => migrateSnapshots(), /Bereinigung|cleanup/);
  assert.equal(decrypt(getSetting(STATE_KEY)!), 'cleanup');
  const encrypted = db.prepare('SELECT snapshot FROM versions ORDER BY id').all();
  failure.mock.restore();
  assert.equal(migrateSnapshots(), 0);
  assert.equal(decrypt(getSetting(STATE_KEY)!), 'ready');
  assert.deepEqual(db.prepare('SELECT snapshot FROM versions ORDER BY id').all(), encrypted);
});

test('a blocked WAL checkpoint prevents startup until cleanup can finish', () => {
  const { rows } = seed();
  makeLegacy(rows[0]!.id);
  const reader = new DatabaseSync(path.join(directory, 'flowvault.db'));
  reader.exec('BEGIN');
  reader.prepare('SELECT id FROM versions').all();
  try {
    assert.throws(() => migrateSnapshots(), /Bereinigung|cleanup/);
    assert.equal(decrypt(getSetting(STATE_KEY)!), 'cleanup');
  } finally {
    reader.exec('ROLLBACK');
    reader.close();
  }
  assert.equal(migrateSnapshots(), 0);
  assert.equal(decrypt(getSetting(STATE_KEY)!), 'ready');
});

test('a wrong or lost application key blocks subsequent startups without rewriting snapshots', () => {
  seed();
  migrateSnapshots();
  const stored = db.prepare('SELECT snapshot FROM versions ORDER BY id').all();
  const entry = new URL('./index.ts', import.meta.url).href;
  const script = `try { await import(${JSON.stringify(entry)}); }
    catch (error) { console.error(error.message); process.exitCode = 1; }`;
  for (const secret of ['wrong-test-key', undefined]) {
    const env: NodeJS.ProcessEnv = { ...process.env, DATA_DIR: directory, HOST: '127.0.0.1', PORT: '0', HEALTH_URL: 'http://127.0.0.1:1' };
    if (secret === undefined) delete env.APP_SECRET;
    else env.APP_SECRET = secret;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env, encoding: 'utf8', timeout: 10_000 });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Anwendungsschlüssel|application key/);
    assert.equal(result.stderr.includes('old-inline-test-secret'), false);
  }
  assert.deepEqual(db.prepare('SELECT snapshot FROM versions ORDER BY id').all(), stored);
});

test('restoring encrypted history on the same instance restores the selected credential reference and inline values', async () => {
  const { instance, rows } = seed();
  migrateSnapshots();
  let remote = workflow('B', 'new-inline-test-secret');
  let written: Snapshot | undefined;
  mock.method(N8nClient.prototype, 'updateWorkflow', async (_id: string, body: Snapshot) => {
    written = structuredClone(body);
    remote = { ...remote, ...body, pinData: body.pinData ?? undefined, tags: body.tags.map((name) => ({ name })) };
    return remote;
  });
  mock.method(N8nClient.prototype, 'getWorkflow', async () => remote);

  const restored = await restoreVersion(rows[0]!.id, { mode: 'overwrite' });
  assert.equal(restored.instanceId, instance.id);
  assert.deepEqual(written!.nodes[0]!.credentials, { httpHeaderAuth: { id: 'A', name: 'Credential A' } });
  assert.deepEqual(written!.nodes[0]!.parameters, workflow('A', 'old-inline-test-secret').nodes[0]!.parameters);
  assert.deepEqual(written!.pinData, workflow('A', '').pinData);
  assert.deepEqual(written!.staticData, workflow('A', '').staticData);
  const current = db.prepare('SELECT id, snapshot FROM versions ORDER BY id DESC LIMIT 1').get() as { id: number; snapshot: Uint8Array };
  assert.ok(isEncryptedSnapshot(current.snapshot));
  assert.deepEqual(loadSnapshot(current.id)!.nodes, written!.nodes);
});
