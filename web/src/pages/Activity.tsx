import { useState } from 'react';
import { Activity } from 'lucide-react';
import { api, useApi, type ActivityItem } from '../api.ts';
import { ActivityRow } from '../components/changes.tsx';
import { Button, Card, EmptyState, ErrorBox, PageHeader, PageLoader } from '../components/ui.tsx';

function dayLabel(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  const y = new Date(Date.now() - 864e5);
  if (d.toDateString() === today.toDateString()) return 'Heute';
  if (d.toDateString() === y.toDateString()) return 'Gestern';
  return d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export function ActivityPage() {
  const first = useApi<ActivityItem[]>('/activity?limit=60');
  const [more, setMore] = useState<ActivityItem[]>([]);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  if (first.loading && !first.data) return <PageLoader />;
  if (first.error) return <ErrorBox>{first.error}</ErrorBox>;
  const items = [...first.data!, ...more];

  async function loadMore() {
    setBusy(true);
    const next = await api<ActivityItem[]>(`/activity?limit=60&before=${items[items.length - 1].id}`);
    setMore((m) => [...m, ...next]);
    if (next.length < 60) setDone(true);
    setBusy(false);
  }

  const groups: { label: string; items: ActivityItem[] }[] = [];
  for (const a of items) {
    const label = dayLabel(a.created_at);
    if (groups[groups.length - 1]?.label !== label) groups.push({ label, items: [] });
    groups[groups.length - 1].items.push(a);
  }

  return (
    <>
      <PageHeader title="Aktivität" subtitle="Jede gesicherte Änderung, neueste zuerst" />
      {items.length === 0 ? (
        <Card><EmptyState icon={<Activity className="size-6" />} title="Noch keine Aktivität" /></Card>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <div key={g.label}>
              <div className="mb-2 flex items-center gap-3 px-1">
                <span className="text-[13px] text-muted">{g.label}</span>
                <span className="h-px flex-1 bg-line" />
                <span className="font-mono text-xs text-dim">{g.items.length}</span>
              </div>
              <Card className="divide-y divide-line overflow-hidden">
                {g.items.map((a) => <ActivityRow key={a.id} a={a} />)}
              </Card>
            </div>
          ))}
          {!done && first.data!.length >= 60 && (
            <div className="flex justify-center">
              <Button loading={busy} onClick={loadMore}>Ältere laden</Button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
