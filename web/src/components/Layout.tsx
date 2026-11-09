import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { Activity, ArrowRightLeft, LayoutDashboard, LogOut, Menu, Server, Settings, Workflow, X } from 'lucide-react';
import { api, useApi, type Instance } from '../api.ts';
import type { SystemInfo } from '../../../shared/system.ts';
import { StatusDot } from './ui.tsx';
import { cx } from '../util.ts';

/** Wortmarke nach dem flown8tive-Prinzip: Name in Tinte, zweiter Teil in Kupfer. */
export function Logo({ className }: { className?: string }) {
  return (
    <div className={cx('text-lg leading-none font-[650] [font-stretch:90%]', className)}>
      Flow<span className="text-accent-hi">Vault</span>
    </div>
  );
}

const NAV = [
  { to: '/', label: 'Übersicht', icon: LayoutDashboard, end: true },
  { to: '/workflows', label: 'Workflows', icon: Workflow },
  { to: '/promote', label: 'Umgebungen', icon: ArrowRightLeft },
  { to: '/instances', label: 'Instanzen', icon: Server },
  { to: '/activity', label: 'Aktivität', icon: Activity },
  { to: '/settings', label: 'Einstellungen', icon: Settings },
];

const rowCls = (active: boolean) =>
  cx(
    'flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors',
    active ? 'bg-panel-3 text-text shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]' : 'text-muted hover:bg-panel-2 hover:text-text',
  );

export function Layout({ onLogout }: { onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const { data: instances } = useApi<Instance[]>('/instances', { poll: (d) => (d.some((i) => i.syncing) ? 2000 : 30000) });
  const system = useApi<SystemInfo>('/system');
  useEffect(() => setOpen(false), [loc.pathname, loc.hash]);

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center px-5">
        <Logo />
      </div>
      <nav className="flex flex-col gap-0.5 px-3">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => rowCls(isActive)}>
            <n.icon className="size-4 shrink-0" />
            {n.label}
          </NavLink>
        ))}
      </nav>

      <div className="mt-6 mb-2 px-5 text-xs text-dim">Instanzen</div>
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3">
        {instances?.map((i) => (
          <NavLink key={i.id} to={`/instances/${i.id}`} className={({ isActive }) => rowCls(isActive)}>
            <span className="flex size-4 shrink-0 items-center justify-center">
              <span className="size-2 rounded-[2px]" style={{ background: i.color }} />
            </span>
            <span className="flex-1 truncate">{i.name}</span>
            <StatusDot ok={i.last_sync_ok} syncing={i.syncing} />
          </NavLink>
        ))}
        {instances?.length === 0 && <div className="px-2.5 text-[13px] text-dim">Noch keine verbunden</div>}
      </div>

      <div className="border-t border-line p-3">
        <Link to="/settings#system" className="mb-2 flex items-center justify-between gap-2 px-2.5 py-1 text-xs text-dim hover:text-muted" title="Versionsinformationen und Updates anzeigen">
          <span>FlowVault {system.data ? `v${system.data.version}` : system.error ? 'Version unbekannt' : 'Version …'}</span>
          {system.data?.revision && <span className="font-mono">{system.data.revision.slice(0, 8)}{system.data.modified ? '*' : ''}</span>}
        </Link>
        <button
          onClick={async () => {
            await api('/auth/logout', { method: 'POST' });
            onLogout();
          }}
          className={cx(rowCls(false), 'w-full')}
        >
          <LogOut className="size-4 shrink-0" />
          Abmelden
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-full">
      <aside className="hidden w-60 shrink-0 border-r border-line bg-sidebar lg:block">{sidebar}</aside>

      {open && (
        <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setOpen(false)}>
          <aside className="h-full w-64 border-r border-line bg-sidebar" onClick={(e) => e.stopPropagation()}>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-line px-4 lg:hidden">
          <Logo />
          <button onClick={() => setOpen((o) => !o)} className="rounded-md p-2 text-muted hover:bg-panel-3" aria-label="Menü">
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-8 sm:py-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
