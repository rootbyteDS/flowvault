/** Browser regression fixture: real Dashboard, local fake responses, no live account. */
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { defaultDashboardLayout, type DashboardLayout } from '../../../shared/dashboard.ts';
import type { Instance, Overview } from '../api.ts';
import { I18nProvider } from '../i18n.tsx';
import { ToastProvider } from '../components/ui.tsx';
import { Dashboard } from '../pages/Dashboard.tsx';
import '../index.css';

localStorage.setItem('fv:lang', 'de');
const initial = defaultDashboardLayout();
for (const id of initial.order) initial.widgets[id].visible = ['instanceCount', 'workflowCount', 'versionCount', 'executions'].includes(id);
initial.sizes.instanceCount = { columns: 3, height: 200 };
initial.sizes.workflowCount = { columns: 3, height: 200 };
initial.sizes.versionCount = { columns: 3, height: 200 };
initial.sizes.executions = { columns: 6, height: 900 };
initial.positions.wide = { instanceCount: { column: 6, top: 0 }, workflowCount: { column: 9, top: 0 },
  versionCount: { column: 0, top: 400 }, executions: { column: 3, top: 400 } };
const now = Date.now();
const instance: Instance = { id: 1, name: 'Browser fixture', base_url: 'https://fixture.invalid', color: '#c2663f',
  enabled: true, syncing: false, include_archived: false, sync_interval: 5, last_sync_at: now, last_sync_ok: true,
  last_sync_error: null, created_at: now, key_hint: 'test', workflows: 242, active_workflows: 200, deleted_workflows: 0, versions: 263 };
const overview: Overview = { stats: { instances: 1, workflows: 242, active: 200, versions: 263, versions_7d: 2,
  last_sync: now, first_backup: now, storage_bytes: 1000 }, days: [], activity: [] };
const read = (): DashboardLayout => JSON.parse(localStorage.getItem('fixture-layout') ?? JSON.stringify(initial));
window.fetch = async (input, opts) => {
  const url = String(input);
  let body: unknown;
  if (url === '/api/instances') body = [instance];
  else if (url === '/api/overview') body = overview;
  else if (url === '/api/dashboard/layout') body = read();
  else if (url === '/api/dashboard/layout/geometry' && opts?.method === 'PATCH') {
    body = { ...read(), ...JSON.parse(String(opts.body)) };
    localStorage.setItem('fixture-layout', JSON.stringify(body));
  } else if (url.startsWith('/api/health/executions/history')) body = {
    days: [{ day: Math.floor(now / 864e5), success: 900, failed: 3, canceled: 0 }], availableFrom: now, availableTo: now,
    settings: { enabled: true, pollMinutes: 5, lookbackDays: 14, retentionDays: 30, includeManual: false },
    instances: [{ instanceId: 1, lastPollAt: now, lastSuccessAt: now, ok: true, incomplete: false }],
  };
  else throw new Error(`Unexpected fixture request: ${url}`);
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
};
createRoot(document.getElementById('root')!).render(<I18nProvider><ToastProvider><MemoryRouter>
  <main style={{ padding: 24 }}><Dashboard /></main>
</MemoryRouter></ToastProvider></I18nProvider>);
