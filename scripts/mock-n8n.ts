/**
 * Mini-Nachbau der n8n Public API zum lokalen Testen von FlowVault.
 *   npm run mock-n8n          → http://localhost:5679, API-Key: test-key (Umgebung „Staging“)
 *   MOCK_ENV=Prod MOCK_PORT=5680 npm run mock-n8n
 *                             → zweite Instanz mit eigenen IDs (z. B. „Slack Prod“)
 *   POST /_mock/mutate        → verändert zufällig einen Workflow (simuliert Bearbeitung)
 *   POST /_mock/break         → ändert einen aktiven Workflow so, dass ein Node ab jetzt oft scheitert
 *                               (?workflow=Name, ?rate=0.4). Ein Wiederherstellen per PUT repariert ihn.
 *   POST /_mock/fix           → alle Workflows laufen wieder fehlerfrei
 *   POST /_mock/run?n=20      → erzeugt sofort n Ausführungen pro aktivem Workflow
 *   POST /_mock/archive?workflow=Name → archiviert einen Workflow bzw. holt ihn zurück („Old Newsletter“ ist archiviert)
 *   Ausführungen entstehen außerdem alle 20 s von selbst (MOCK_EXEC_MS).
 *   /v1/models, /v1/chat/completions → Nachbau der Melious-API (Key: test-ai-key)
 *     In FlowVault als Basis-URL http://localhost:5679/v1 eintragen.
 */
import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.env.MOCK_PORT ?? 5679);
const KEY = process.env.MOCK_KEY ?? 'test-key';
const ENV = process.env.MOCK_ENV ?? 'Staging';
const uid = () => crypto.randomUUID();

type Node = { id: string; name: string; type: string; typeVersion: number; position: [number, number]; parameters: Record<string, unknown>; credentials?: Record<string, unknown> };
type Wf = {
  id: string; name: string; active: boolean; nodes: Node[]; connections: Record<string, unknown>;
  settings: Record<string, unknown>; staticData: unknown; tags: { id: string; name: string }[];
  versionId: string; createdAt: string; updatedAt: string; pinData?: Record<string, unknown>; isArchived?: boolean;
};

const node = (name: string, type: string, x: number, y: number, parameters: Record<string, unknown> = {}): Node => ({
  id: uid(), name, type: `n8n-nodes-base.${type}`, typeVersion: 1, position: [x, y], parameters,
});
const link = (pairs: [string, string, number?][]) => {
  const c: Record<string, { main: { node: string; type: string; index: number }[][] }> = {};
  for (const [from, to, out = 0] of pairs) {
    c[from] ??= { main: [] };
    while (c[from].main.length <= out) c[from].main.push([]);
    c[from].main[out].push({ node: to, type: 'main', index: 0 });
  }
  return c;
};
const now = () => new Date().toISOString();
const make = (name: string, active: boolean, nodes: Node[], connections: Record<string, unknown>, tags: string[]): Wf => ({
  id: crypto.randomBytes(8).toString('base64url'), name, active, nodes, connections,
  settings: { executionOrder: 'v1' }, staticData: null, tags: tags.map((t) => ({ id: uid(), name: t })),
  versionId: uid(), createdAt: now(), updatedAt: now(),
});

// Credentials je „Umgebung“ – eigene IDs/Namen pro Instanz, wie bei echtem Staging/Prod
const credentials = [
  { id: `cred-${ENV.toLowerCase()}-slack`, name: `Slack ${ENV}`, type: 'slackApi' },
  { id: `cred-${ENV.toLowerCase()}-hubspot`, name: `HubSpot ${ENV}`, type: 'hubspotApi' },
];
const dataTableId = `dt-${ENV.toLowerCase()}`;
const cred = (i: number) => ({ [credentials[i]!.type]: { id: credentials[i]!.id, name: credentials[i]!.name } });

const workflows: Wf[] = [
  make('Lead Intake → CRM', true, [
    node('Webhook', 'webhook', 0, 0, { path: 'lead', httpMethod: 'POST' }),
    node('Validate Lead', 'if', 220, 0, { conditions: { email: 'notEmpty' } }),
    node('Create Contact', 'hubspot', 440, -100, { resource: 'contact', operation: 'create', dataTableId }),
    node('Notify Slack', 'slack', 660, -100, { channel: '#sales', text: 'Neuer Lead: {{$json.email}}' }),
    node('Reject', 'respondToWebhook', 440, 120, { respondWith: 'json', responseCode: 422 }),
  ], link([['Webhook', 'Validate Lead'], ['Validate Lead', 'Create Contact'], ['Validate Lead', 'Reject', 1], ['Create Contact', 'Notify Slack']]), ['sales', 'crm']),
  make('Daily KPI Report', true, [
    node('Every Morning', 'scheduleTrigger', 0, 0, { rule: { interval: [{ field: 'cronExpression', expression: '0 7 * * *' }] } }),
    node('Fetch Stripe', 'httpRequest', 220, -80, { url: 'https://api.stripe.com/v1/charges', method: 'GET' }),
    node('Fetch Analytics', 'httpRequest', 220, 80, { url: 'https://analytics.example.com/api/daily', method: 'GET' }),
    node('Merge', 'merge', 440, 0, { mode: 'combine' }),
    node('Build Report', 'code', 660, 0, { jsCode: 'return [{ json: { revenue: 1200 } }];' }),
    node('Send Mail', 'emailSend', 880, 0, { toEmail: 'team@example.com', subject: 'Daily KPIs' }),
  ], link([['Every Morning', 'Fetch Stripe'], ['Every Morning', 'Fetch Analytics'], ['Fetch Stripe', 'Merge'], ['Fetch Analytics', 'Merge'], ['Merge', 'Build Report'], ['Build Report', 'Send Mail']]), ['reporting']),
  make('Error Alerts', false, [
    node('Error Trigger', 'errorTrigger', 0, 0),
    node('Format Message', 'set', 220, 0, { values: { text: 'Workflow {{$json.workflow.name}} failed' } }),
    node('Telegram', 'telegram', 440, 0, { chatId: '12345' }),
  ], link([['Error Trigger', 'Format Message'], ['Format Message', 'Telegram']]), ['ops']),
];

// Umgebungsspezifische Referenzen wie im echten Leben: Credentials je Instanz,
// Data-Table-ID, Error-Workflow-ID und ein Sub-Workflow-Aufruf (Cross-Flow).
const lead = workflows[0]!;
const errorAlerts = workflows[2]!;
(lead.nodes[2] as Node).credentials = cred(1);
(lead.nodes[3] as Node).credentials = cred(0);
lead.settings = { executionOrder: 'v1', errorWorkflow: errorAlerts.id };
workflows.push(
  make('Cross-Flow', false, [
    node('Call Alerts', 'executeWorkflow', 0, 0, { workflowId: errorAlerts.id, cachedResultName: errorAlerts.name }),
    node('After Call', 'noOp', 220, 0),
  ], link([['Call Alerts', 'After Call']]), ['ops']),
);

// Archivierter Workflow – FlowVault sichert ihn nur, wenn das bei der Instanz eingeschaltet ist
workflows.push({
  ...make('Old Newsletter', false, [node('Every Monday', 'scheduleTrigger', 0, 0), node('Send Newsletter', 'emailSend', 220, 0)], link([['Every Monday', 'Send Newsletter']]), ['marketing']),
  isArchived: true,
});

// Startzustand: zuletzt vor drei Tagen gespeichert, damit die Ausführungs-Historie einer Version zugeordnet werden kann
const THREE_DAYS = 3 * 864e5;
for (const wf of workflows) wf.updatedAt = wf.createdAt = new Date(Date.now() - THREE_DAYS).toISOString();

// ── Ausführungen ──
type Exec = {
  id: number; workflowId: string; status: 'success' | 'error'; mode: string; finished: boolean;
  startedAt: string; stoppedAt: string; errorNode?: string; errorMessage?: string;
};
const executions: Exec[] = [];
const broken = new Map<string, { node: string; rate: number }>();
let execSeq = 1000;

function execute(wf: Wf, at = Date.now()) {
  const b = broken.get(wf.id);
  const fail = b ? Math.random() < b.rate : Math.random() < 0.02;
  const node = b?.node ?? wf.nodes[wf.nodes.length - 1].name;
  executions.push({
    id: ++execSeq,
    workflowId: wf.id,
    status: fail ? 'error' : 'success',
    mode: Math.random() < 0.05 ? 'manual' : wf.nodes[0].type.endsWith('webhook') ? 'webhook' : 'trigger',
    finished: !fail,
    startedAt: new Date(at).toISOString(),
    stoppedAt: new Date(at + 800).toISOString(),
    ...(fail ? { errorNode: node, errorMessage: b ? `The service was not able to process your request (HTTP 500) – ${node}` : 'Timeout nach 30 s' } : {}),
  });
}
// Historie: 60 Läufe pro aktivem Workflow über die letzten zwei Tage
for (const wf of workflows.filter((w) => w.active)) {
  for (let i = 60; i > 0; i--) execute(wf, Date.now() - i * 48 * 60_000);
}
executions.sort((a, b) => a.id - b.id);
setInterval(() => workflows.filter((w) => w.active).forEach((w) => execute(w)), Number(process.env.MOCK_EXEC_MS ?? 20_000));

function breakWorkflow(name: string | null, rate: number) {
  const candidates = workflows.filter((w) => w.active && (!name || w.name === name));
  const wf = candidates[Math.floor(Math.random() * candidates.length)];
  if (!wf) return null;
  const n = wf.nodes.find((x) => /httpRequest|hubspot|slack|emailSend/.test(x.type)) ?? wf.nodes[1] ?? wf.nodes[0];
  n.parameters = { ...n.parameters, timeout: 500, url: n.parameters.url ? `${n.parameters.url}/v2` : undefined };
  wf.versionId = uid();
  wf.updatedAt = now();
  broken.set(wf.id, { node: n.name, rate });
  return { workflow: wf.name, node: n.name, rate };
}

function execJson(e: Exec, includeData: boolean) {
  const { errorNode, errorMessage, ...rest } = e;
  if (!includeData) return rest;
  return {
    ...rest,
    data: {
      resultData: {
        runData: {},
        lastNodeExecuted: errorNode,
        ...(errorNode ? { error: { message: errorMessage, node: { name: errorNode } } } : {}),
      },
    },
  };
}

function mutate() {
  const wf = workflows[Math.floor(Math.random() * workflows.length)];
  const r = Math.random();
  if (r < 0.35) {
    const n = wf.nodes[Math.floor(Math.random() * wf.nodes.length)];
    n.parameters = { ...n.parameters, note: `geändert ${new Date().toLocaleTimeString('de-DE')}` };
  } else if (r < 0.6) {
    const last = wf.nodes[wf.nodes.length - 1];
    const n = node(`Log ${wf.nodes.length}`, 'noOp', last.position[0] + 220, last.position[1]);
    wf.nodes.push(n);
    (wf.connections as Record<string, unknown>)[last.name] = { main: [[{ node: n.name, type: 'main', index: 0 }]] };
  } else if (r < 0.75 && wf.nodes.length > 3) {
    const n = wf.nodes.pop()!;
    delete (wf.connections as Record<string, unknown>)[n.name];
    for (const c of Object.values(wf.connections) as { main: { node: string }[][] }[]) c.main = c.main.map((o) => o.filter((t) => t.node !== n.name));
  } else if (r < 0.85) {
    wf.active = !wf.active;
  } else {
    wf.nodes.forEach((n) => (n.position = [n.position[0] + 20, n.position[1]]));
  }
  wf.staticData = { lastPoll: Date.now() }; // darf KEINE neue Version erzeugen
  wf.versionId = uid();
  wf.updatedAt = now();
  return wf;
}

function send(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const ALLOWED = ['name', 'nodes', 'connections', 'settings', 'staticData'];

http.createServer(async (req, res) => {
  const url = new URL(req.url!, 'http://x');
  let body: Record<string, unknown> = {};
  if (req.method !== 'GET') {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    if (chunks.length) body = JSON.parse(Buffer.concat(chunks).toString());
  }
  console.log(req.method, url.pathname + url.search);

  if (url.pathname === '/_mock/mutate') return send(res, 200, { mutated: mutate().name });
  if (url.pathname === '/_mock/break') {
    return send(res, 200, breakWorkflow(url.searchParams.get('workflow'), Number(url.searchParams.get('rate') ?? 0.4)) ?? { error: 'kein aktiver Workflow' });
  }
  if (url.pathname === '/_mock/fix') {
    broken.clear();
    return send(res, 200, { ok: true });
  }
  if (url.pathname === '/_mock/archive') {
    const wf = workflows.find((w) => w.name === url.searchParams.get('workflow'));
    if (!wf) return send(res, 404, { error: 'Workflow nicht gefunden' });
    wf.isArchived = !wf.isArchived;
    if (wf.isArchived) wf.active = false;
    wf.updatedAt = now();
    return send(res, 200, { name: wf.name, isArchived: wf.isArchived });
  }
  if (url.pathname === '/_mock/run') {
    const n = Math.min(500, Number(url.searchParams.get('n') ?? 20));
    for (let i = 0; i < n; i++) workflows.filter((w) => w.active).forEach((w) => execute(w));
    return send(res, 200, { ok: true, total: executions.length });
  }

  // ── Melious-Nachbau ──
  if (url.pathname.startsWith('/v1/')) {
    if (req.headers.authorization !== 'Bearer test-ai-key') return send(res, 401, { error: { message: 'invalid api key' } });
    if (url.pathname === '/v1/models') return send(res, 200, { object: 'list', data: [{ id: 'qwen3.6-35b-a3b' }, { id: 'mistral-small-3.2' }] });
    if (url.pathname === '/v1/chat/completions') {
      const prompt = String((body.messages as { content: string }[])?.at(-1)?.content ?? '');
      if (process.env.MOCK_LOG_PROMPT) console.log('--- PROMPT ---\n' + prompt + '\n--------------');
      const lines = prompt.split('\n').filter((l) => l.startsWith('- '));
      const first = lines[0]?.slice(2) ?? 'Workflow beschrieben';
      const title = /erste gesicherte Version/.test(prompt) ? 'Fehlermeldungen per Telegram melden' : first.replace(/"/g, '„').slice(0, 70);
      const content = JSON.stringify({ title, details: lines.slice(0, 3).map((l) => l.slice(2, 90)) });
      return send(res, 200, { model: String(body.model), choices: [{ message: { role: 'assistant', content } }] });
    }
  }
  if (!url.pathname.startsWith('/api/v1/')) return send(res, 404, { message: 'not found' });
  if (req.headers['x-n8n-api-key'] !== KEY) return send(res, 401, { message: 'unauthorized' });

  if (url.pathname === '/api/v1/executions' && req.method === 'GET') {
    const limit = Math.min(250, Number(url.searchParams.get('limit') ?? 100));
    const offset = Number(url.searchParams.get('cursor') ?? 0);
    const status = url.searchParams.get('status');
    const wfId = url.searchParams.get('workflowId');
    const includeData = url.searchParams.get('includeData') === 'true';
    const list = executions.filter((e) => (!status || e.status === status) && (!wfId || e.workflowId === wfId)).reverse();
    const data = list.slice(offset, offset + limit).map((e) => execJson(e, includeData));
    return send(res, 200, { data, nextCursor: offset + limit < list.length ? String(offset + limit) : null });
  }

  if (url.pathname === '/api/v1/credentials' && req.method === 'GET') {
    return send(res, 200, { data: credentials });
  }

  const m = url.pathname.match(/^\/api\/v1\/workflows(?:\/([^/]+))?$/);
  if (!m) return send(res, 404, { message: 'not found' });
  const id = m[1];

  const extra = Object.keys(body).filter((k) => !ALLOWED.includes(k));
  if ((req.method === 'POST' || req.method === 'PUT') && extra.length) {
    return send(res, 400, { message: 'request/body must NOT have additional properties' });
  }

  if (!id && req.method === 'GET') {
    const limit = Number(url.searchParams.get('limit') ?? 100);
    const offset = Number(url.searchParams.get('cursor') ?? 0);
    const data = workflows.slice(offset, offset + limit);
    return send(res, 200, { data, nextCursor: offset + limit < workflows.length ? String(offset + limit) : null });
  }
  if (!id && req.method === 'POST') {
    const wf = make(String(body.name), false, body.nodes as Node[], body.connections as Record<string, unknown>, []);
    wf.settings = body.settings as Record<string, unknown>;
    workflows.push(wf);
    return send(res, 200, wf);
  }
  const wf = workflows.find((w) => w.id === id);
  if (!wf) return send(res, 404, { message: 'Not Found' });
  if (req.method === 'GET') return send(res, 200, wf);
  if (req.method === 'PUT') {
    Object.assign(wf, { name: body.name, nodes: body.nodes, connections: body.connections, settings: body.settings, versionId: uid(), updatedAt: now() });
    broken.delete(wf.id); // Wiederherstellen repariert den Fehler
    return send(res, 200, wf);
  }
  if (req.method === 'DELETE') {
    workflows.splice(workflows.indexOf(wf), 1);
    return send(res, 200, wf);
  }
  send(res, 405, { message: 'method not allowed' });
}).listen(PORT, () => console.log(`Mock n8n auf http://localhost:${PORT} – Umgebung „${ENV}“ (API-Key: ${KEY})`));
