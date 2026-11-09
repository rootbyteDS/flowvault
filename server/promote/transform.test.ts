import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyMappingSet, transformSnapshot, type MappingSet } from './transform.ts';
import type { Snapshot, WfNode } from '../../shared/diff.ts';
import { getTranslator, renderMessage } from '../../shared/i18n/index.ts';

/** Meldungen kommen übersetzbar (`i18n:…`) aus transformSnapshot – hier in Deutsch lesbar machen. */
const german = getTranslator('de');
const rendered = (list: string[]) => list.map((m) => renderMessage(m, german));

const node = (over: Partial<WfNode>): WfNode => ({ name: 'N', type: 'n8n-nodes-base.noOp', ...over });

const snap = (nodes: WfNode[], settings: Record<string, unknown> = {}): Snapshot => ({
  n8nId: 'src-1',
  name: 'Lead Intake',
  active: false,
  nodes,
  connections: {},
  settings,
  tags: [],
});

const mappings = (over: Partial<MappingSet> = {}): MappingSet => ({
  ...emptyMappingSet(),
  ...over,
});

test('ersetzt Credential-ID und -Namen – n8n braucht beides', () => {
  const s = snap([
    node({ name: 'Notify Slack', type: 'n8n-nodes-base.slack', credentials: { slackApi: { id: 'stg-1', name: 'Slack Staging' } } }),
  ]);
  const m = mappings({ credentials: new Map([['stg-1', { id: 'prd-7', name: 'Slack Prod' }]]) });
  const r = transformSnapshot(s, m);
  assert.deepEqual(r.snapshot.nodes[0]!.credentials, { slackApi: { id: 'prd-7', name: 'Slack Prod' } });
  assert.ok(rendered(r.applied).some((a) => a.includes('Slack Staging') && a.includes('Slack Prod')));
  assert.equal(r.missing.length, 0);
});

test('meldet Credentials ohne Zuordnung', () => {
  const s = snap([node({ credentials: { httpBasicAuth: { id: 'stg-9', name: 'Internal API' } } })]);
  const r = transformSnapshot(s, emptyMappingSet());
  assert.deepEqual(r.snapshot.nodes[0]!.credentials, { httpBasicAuth: { id: 'stg-9', name: 'Internal API' } });
  assert.deepEqual(rendered(r.missing), ['Credential „Internal API“ (httpBasicAuth) ohne Zuordnung']);
});

test('ersetzt Sub-Workflow (Execute Workflow) inklusive Cache-ID, meldet fehlende', () => {
  const s = snap([
    node({ name: 'Call', type: 'n8n-nodes-base.executeWorkflow', parameters: { workflowId: 'wf-stg', cachedResultName: 'Error Alerts' }, cachedResultWorkflowId: 'wf-stg' }),
  ]);
  const mapped = transformSnapshot(s, mappings({ workflows: new Map([['wf-stg', 'wf-prd']]) }), { workflowNames: new Map([['wf-stg', 'Error Alerts'], ['wf-prd', 'Error Alerts Prod']]) });
  assert.equal((mapped.snapshot.nodes[0]!.parameters as Record<string, unknown>).workflowId, 'wf-prd');
  assert.equal(mapped.snapshot.nodes[0]!.cachedResultWorkflowId, 'wf-prd');
  assert.ok(rendered(mapped.applied).some((a) => a.startsWith('Sub-Workflow')));

  const missing = transformSnapshot(s, emptyMappingSet(), { workflowNames: new Map([['wf-stg', 'Error Alerts']]) });
  assert.deepEqual(rendered(missing.missing), ['Sub-Workflow „Error Alerts“ ohne Zuordnung']);
});

test('ersetzt den Error-Workflow in den Settings und meldet fehlende Zuordnung', () => {
  const s = snap([node({})], { executionOrder: 'v1', errorWorkflow: 'wf-stg' });
  const mapped = transformSnapshot(s, mappings({ workflows: new Map([['wf-stg', 'wf-prd']]) }));
  assert.equal(mapped.snapshot.settings!.errorWorkflow, 'wf-prd');
  assert.ok(rendered(mapped.applied).some((a) => a.includes('Error-Workflow')));

  const r = transformSnapshot(s, emptyMappingSet());
  assert.equal(r.snapshot.settings!.errorWorkflow, 'wf-stg');
  assert.deepEqual(rendered(r.missing), ['Error-Workflow „wf-stg“ ohne Zuordnung']);
});

test('ersetzt den Webhook-Pfad nur direkt am Webhook-Node, nicht verschachtelt', () => {
  const s = snap([
    node({ name: 'Hook', type: 'n8n-nodes-base.webhook', parameters: { path: 'lead', options: { nestedPath: 'lead' } } }),
    node({ name: 'File', type: 'n8n-nodes-base.readWriteFile', parameters: { path: 'lead' } }),
  ]);
  const r = transformSnapshot(s, mappings({ webhookPaths: new Map([['lead', 'lead-prod']]) }));
  const hook = r.snapshot.nodes.find((n) => n.name === 'Hook')!;
  const file = r.snapshot.nodes.find((n) => n.name === 'File')!;
  assert.equal((hook.parameters as Record<string, unknown>).path, 'lead-prod');
  assert.deepEqual((hook.parameters as Record<string, unknown>).options, { nestedPath: 'lead' }); // verschachtelt bleibt
  assert.equal((file.parameters as Record<string, unknown>).path, 'lead'); // kein Webhook-Node
  assert.ok(rendered(r.applied).some((a) => a.includes('Webhook-Pfad')));
});

test('Data-Tables: dataTableId wird ersetzt/ergibt eine Warnung, tableId nur bei Zuordnung', () => {
  const s = snap([
    node({ name: 'Data', type: 'n8n-nodes-base.set', parameters: { dataTableId: 'dt-stg', tableId: 'tab-stg' } }),
  ]);
  const mapped = transformSnapshot(s, mappings({ dataTables: new Map([['dt-stg', 'dt-prd'], ['tab-stg', 'tab-prd']]) }));
  const p = mapped.snapshot.nodes[0]!.parameters as Record<string, unknown>;
  assert.equal(p.dataTableId, 'dt-prd');
  assert.equal(p.tableId, 'tab-prd');

  const r = transformSnapshot(s, emptyMappingSet());
  assert.deepEqual(rendered(r.missing), ['Data-Table „dt-stg“ ohne Zuordnung']); // tableId bleibt still
});

test('Ausdrücke (={{ … }}) und unge-mappte Keys bleiben unberührt', () => {
  const s = snap([
    node({
      name: 'Call',
      type: 'n8n-nodes-base.executeWorkflow',
      parameters: { workflowId: '={{ $json.id }}', text: '={{ $json.path }}', keep: 'wf-stg' },
    }),
  ]);
  const r = transformSnapshot(s, mappings({ workflows: new Map([['wf-stg', 'wf-prd']]) }));
  const p = r.snapshot.nodes[0]!.parameters as Record<string, unknown>;
  assert.equal(p.workflowId, '={{ $json.id }}');
  assert.equal(p.text, '={{ $json.path }}');
  assert.equal(p.keep, 'wf-stg');
  assert.deepEqual(rendered(r.missing), []);
});

test('verändert das Original nicht und arbeitet auf einer tiefen Kopie', () => {
  const s = snap([node({ name: 'Call', type: 'n8n-nodes-base.executeWorkflow', parameters: { workflowId: 'wf-stg' } })], { errorWorkflow: 'wf-stg' });
  const before = JSON.stringify(s);
  const r = transformSnapshot(s, mappings({ workflows: new Map([['wf-stg', 'wf-prd']]) }));
  assert.equal(JSON.stringify(s), before); // Original unangetastet
  assert.notEqual(r.snapshot.nodes[0], s.nodes[0]); // tiefe Kopie
  assert.equal((r.snapshot.nodes[0]!.parameters as Record<string, unknown>).workflowId, 'wf-prd');
  assert.equal(r.snapshot.settings!.errorWorkflow, 'wf-prd');
});

test('Resource-Locators ersetzen die value-ID und erhalten Auswahlmetadaten', () => {
  const s = snap([
    node({ type: 'n8n-nodes-base.executeWorkflow', parameters: { workflowId: { __rl: true, value: 'wf-src', mode: 'list', cachedResultName: 'Subflow' } } }),
    node({ type: 'n8n-nodes-base.dataTable', parameters: { dataTableId: { __rl: true, value: 'dt-src', mode: 'list' } } }),
  ]);
  const result = transformSnapshot(s, mappings({ workflows: new Map([['wf-src', 'wf-target']]), dataTables: new Map([['dt-src', 'dt-target']]) }));
  assert.deepEqual(result.snapshot.nodes[0]!.parameters!.workflowId, { __rl: true, value: 'wf-target', mode: 'list', cachedResultName: 'Subflow' });
  assert.deepEqual(result.snapshot.nodes[1]!.parameters!.dataTableId, { __rl: true, value: 'dt-target', mode: 'list' });
  assert.deepEqual(result.missing, []);
});

test('fehlende Resource-Locator-Referenzen werden gemeldet; verschachtelte Webhook-Pfade bleiben unverändert', () => {
  const s = snap([
    node({ type: 'n8n-nodes-base.executeWorkflow', parameters: { workflowId: { __rl: true, value: 'wf-src', mode: 'list' } } }),
    node({ type: 'n8n-nodes-base.webhook', parameters: { path: 'lead', options: { path: 'lead' } } }),
  ]);
  const result = transformSnapshot(s, mappings({ webhookPaths: new Map([['lead', 'lead-prod']]) }));
  assert.equal(result.missing.length, 1);
  assert.deepEqual(result.snapshot.nodes[1]!.parameters, { path: 'lead-prod', options: { path: 'lead' } });
});
