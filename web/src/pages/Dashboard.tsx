import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Plus, RefreshCw, Server } from 'lucide-react';
import { api, useApi, type Instance, type Overview } from '../api.ts';
import { ActivityRow } from '../components/changes.tsx';
import { AlertsCard } from '../components/health.tsx';
import { InstanceForm } from '../components/InstanceForm.tsx';
import { Button, Card, EmptyState, ErrorBox, PageHeader, PageLoader, StatusDot, useToast } from '../components/ui.tsx';
import { cx, formatBytes, intervalLabel, timeAgo } from '../util.ts';

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub: React.ReactNode }) {
  return (
    <Card className="px-5 py-4">
      <div className="text-[13px] text-muted">{label}</div>
      <div className="mt-2 text-[28px] leading-none font-medium [font-stretch:92%]">{value}</div>
      <div className="mt-2 text-xs text-dim">{sub}</div>
    </Card>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

/** Das eine farbige Element der Übersicht: jede gesicherte Änderung pro Tag, 12 Monate. */
function Heatmap({ days }: { days: { day: number; n: number }[] }) {
  const weeks = 53;
  const { grid, total, max, today } = useMemo(() => {
    const map = new Map(days.map((d) => [d.day, d.n]));
    const today = Math.floor(Date.now() / 864e5);
    const dow = (new Date().getDay() + 6) % 7; // Mo = 0
    const start = today - dow - (weeks - 1) * 7;
    const grid: { day: number; n: number }[][] = [];
    let total = 0, max = 0;
    for (let w = 0; w < weeks; w++) {
      const col = [];
      for (let d = 0; d < 7; d++) {
        const day = start + w * 7 + d;
        const n = day > today ? -1 : (map.get(day) ?? 0);
        if (n > 0) { total += n; max = Math.max(max, n); }
        col.push({ day, n });
      }
      grid.push(col);
    }
    return { grid, total, max, today };
  }, [days]);

  const level = (n: number) => {
    if (n < 0) return 'bg-transparent';
    if (n === 0) return 'bg-panel-3';
    const r = n / Math.max(max, 4);
    return r > 0.75 ? 'bg-accent' : r > 0.5 ? 'bg-accent/75' : r > 0.25 ? 'bg-accent/50' : 'bg-accent/30';
  };
  const monthOf = (day: number) => new Date(day * 864e5).getUTCMonth();

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-sm font-medium">Änderungen der letzten 12 Monate</h2>
        <span className="font-mono text-xs text-dim">{total} Versionen</span>
      </div>
      <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))` }}>
        {grid.map((col, i) => (
          <div key={`m${i}`} className="h-4 overflow-visible font-mono text-[11px] whitespace-nowrap text-dim">
            {(i === 0 || monthOf(col[0].day) !== monthOf(grid[i - 1][0].day)) && i < weeks - 2 ? MONTHS[monthOf(col[0].day)] : ''}
          </div>
        ))}
        {grid.map((col, i) => (
          <div key={i} className="grid gap-[3px]">
            {col.map((c) => (
              <div
                key={c.day}
                className={cx('aspect-square w-full max-w-[14px] rounded-[3px]', level(c.n), c.day === today && 'ring-1 ring-text/40')}
                title={c.n >= 0 ? `${new Date(c.day * 864e5).toLocaleDateString('de-DE')}: ${c.n} ${c.n === 1 ? 'Änderung' : 'Änderungen'}` : ''}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-end gap-1 text-xs text-dim">
        weniger
        {['bg-panel-3', 'bg-accent/30', 'bg-accent/50', 'bg-accent/75', 'bg-accent'].map((c) => (
          <span key={c} className={cx('size-2.5 rounded-[2px]', c)} />
        ))}
        mehr
      </div>
    </Card>
  );
}

export function Dashboard() {
  const toast = useToast();
  const nav = useNavigate();
  const [showForm, setShowForm] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const instances = useApi<Instance[]>('/instances', { poll: (d) => (d.some((i) => i.syncing) ? 2000 : false) });
  const overview = useApi<Overview>('/overview', { poll: () => (instances.data?.some((i) => i.syncing) ? 2500 : 30000) });

  async function syncAll() {
    setSyncing(true);
    try {
      const r = await api<{ ok: boolean; count: number }>('/sync-all', { method: 'POST' });
      toast(r.ok ? `${r.count} ${r.count === 1 ? 'Instanz' : 'Instanzen'} gesichert` : 'Mindestens eine Instanz konnte nicht gesichert werden', r.ok ? 'ok' : 'error');
    } finally {
      setSyncing(false);
      overview.reload();
      instances.reload();
    }
  }

  if (overview.loading && !overview.data) return <PageLoader />;
  if (overview.error) return <ErrorBox>{overview.error}</ErrorBox>;
  const o = overview.data!;
  const list = instances.data ?? [];

  if (list.length === 0) {
    return (
      <>
        <PageHeader title="Übersicht" />
        <Card>
          <EmptyState
            icon={<Server className="size-6" />}
            title="Erste n8n-Instanz verbinden"
            action={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setShowForm(true)}>Instanz verbinden</Button>}
          >
            FlowVault holt alle Workflows über die n8n API, speichert jede Änderung als Version und zeigt, was sich geändert hat
          </EmptyState>
        </Card>
        <InstanceForm open={showForm} onClose={() => setShowForm(false)} onSaved={(i) => nav(`/instances/${i.id}`)} />
      </>
    );
  }

  const reachable = list.filter((i) => i.last_sync_ok).length;

  return (
    <>
      <PageHeader
        title="Übersicht"
        subtitle={o.stats.last_sync ? `Letzte Sicherung ${timeAgo(o.stats.last_sync)}` : 'Noch keine Sicherung'}
        actions={
          <>
            <Button icon={<Plus className="size-4" />} onClick={() => setShowForm(true)}>Instanz</Button>
            <Button variant="primary" icon={<RefreshCw className={cx('size-4', syncing && 'animate-spin')} />} onClick={syncAll} disabled={syncing}>
              Alle jetzt sichern
            </Button>
          </>
        }
      />

      <AlertsCard />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Instanzen" value={o.stats.instances} sub={`${reachable} von ${list.length} erreichbar`} />
        <Stat label="Workflows" value={o.stats.workflows} sub={`${o.stats.active} aktiv`} />
        <Stat label="Versionen" value={o.stats.versions} sub={`${o.stats.versions_7d} in den letzten 7 Tagen`} />
        <Stat label="Speicher" value={formatBytes(o.stats.storage_bytes)} sub={`für ${o.stats.versions} Versionen`} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <div className="min-w-0 space-y-6 xl:col-span-2">
          <Heatmap days={o.days} />
          <Card>
            <div className="flex items-baseline justify-between border-b border-line px-4 py-3">
              <h2 className="text-sm font-medium">Letzte Änderungen</h2>
              <Link to="/activity" className="text-[13px] text-muted transition-colors hover:text-text">Alle anzeigen</Link>
            </div>
            <div className="divide-y divide-line">
              {o.activity.map((a) => <ActivityRow key={a.id} a={a} />)}
              {o.activity.length === 0 && <div className="px-4 py-12 text-center text-sm text-muted">Noch keine Änderungen</div>}
            </div>
          </Card>
        </div>

        <div className="min-w-0">
          <Card>
            <div className="border-b border-line px-4 py-3">
              <h2 className="text-sm font-medium">Instanzen</h2>
            </div>
            <div className="divide-y divide-line">
              {list.map((i) => (
                <Link key={i.id} to={`/instances/${i.id}`} className="block px-4 py-3 transition-colors hover:bg-panel-2">
                  <div className="flex items-center gap-2.5">
                    <span className="size-2 shrink-0 rounded-[2px]" style={{ background: i.color }} />
                    <span className="flex-1 truncate text-sm font-medium">{i.name}</span>
                    <StatusDot ok={i.last_sync_ok} syncing={i.syncing} />
                  </div>
                  <div className="mt-1 truncate pl-[18px] text-[13px] text-muted">{i.base_url.replace(/^https?:\/\//, '')}</div>
                  <div className="mt-2 flex flex-wrap gap-x-3 pl-[18px] font-mono text-xs text-dim">
                    <span>{i.workflows} Workflows</span>
                    <span>{i.active_workflows} aktiv</span>
                    <span>{i.versions} Versionen</span>
                  </div>
                  <div className="mt-1 pl-[18px] text-xs text-dim">
                    {i.syncing ? 'Sichert gerade' : i.last_sync_ok === false ? <span className="text-del">Letzter Sync fehlgeschlagen</span> : `Gesichert ${timeAgo(i.last_sync_at)} · ${intervalLabel(i.sync_interval)}`}
                  </div>
                </Link>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <InstanceForm open={showForm} onClose={() => setShowForm(false)} onSaved={() => { instances.reload(); overview.reload(); }} />
    </>
  );
}
