/**
 * Tests für die Ursachenanalyse (server/diagnose.ts):
 * Korreliert fehlgeschlagenen Node mit dem Diff gegenüber der Vorversion,
 * schlägt die stabile Version für ein Rollback vor und schwärzt eingebettete Geheimnisse.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flowvault-diagnose-'));
const saved = { ...process.env };
const CANARY = 'sk_live_CANARY1234567890abcdef';

before(() => {
  Object.assign(process.env, {
    DATA_DIR: directory,
    APP_SECRET: 'diagnose-test-secret',
    NOTIFY_DISABLED: '1',
  });
});

after(() => {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('diagnoseWorkflowFailure pinpoints the modified node, suggests rollback, and redacts secrets', async () => {
  const { db } = await import('./db.ts');
  const { encrypt } = await import('./crypto.ts');
  const { recordWorkflow, getInstance } = await import('./sync.ts');
  const { diagnoseWorkflowFailure } = await import('./diagnose.ts');

  const ins = db
    .prepare('INSERT INTO instances (name, base_url, api_key_enc, created_at) VALUES (?,?,?,?)')
    .run('Prod', 'https://n8n.example.com', encrypt('test-key'), Date.now());
  const inst = getInstance(Number(ins.lastInsertRowid))!;

  // Version 1 (stabil)
  recordWorkflow(inst, {
    id: 'wf1',
    name: 'Daily KPI Report',
    active: true,
    nodes: [
      { id: 'n1', name: 'Schedule', type: 'n8n-nodes-base.scheduleTrigger', parameters: {} },
      { id: 'n2', name: 'Fetch Stripe', type: 'n8n-nodes-base.httpRequest', parameters: { url: 'https://api.stripe.com/v1/charges' } },
    ],
    connections: {},
  });

  // Version 2 (geänderter Node „Fetch Stripe“ mit geheimer Konstante)
  recordWorkflow(inst, {
    id: 'wf1',
    name: 'Daily KPI Report',
    active: true,
    nodes: [
      { id: 'n1', name: 'Schedule', type: 'n8n-nodes-base.scheduleTrigger', parameters: {} },
      {
        id: 'n2',
        name: 'Fetch Stripe',
        type: 'n8n-nodes-base.httpRequest',
        parameters: { url: 'https://api.stripe.com/v1/wrong', apiKey: CANARY },
      },
    ],
    connections: {},
  });

  const wf = db.prepare('SELECT id FROM workflows WHERE n8n_id = ?').get('wf1') as { id: number };
  const result = await diagnoseWorkflowFailure({
    workflowId: wf.id,
    errorNode: 'Fetch Stripe',
    errorMessage: `401 Unauthorized: token=${CANARY} rejected`,
    language: 'de',
  });

  assert.ok(result);
  assert.equal(result.diagnosis.analyzedVersionNumber, 2);
  assert.equal(result.diagnosis.comparedVersionNumber, 1);
  assert.equal(result.diagnosis.recommendRollback, true);
  assert.equal(result.diagnosis.rollbackVersionNumber, 1);
  assert.ok(result.diagnosis.culpritChange?.includes('Fetch Stripe'));
  assert.ok(result.diagnosis.cause.includes('401'));
  assert.ok(!JSON.stringify(result.diagnosis).includes(CANARY), 'no secret canary in diagnosis');
});
