import { Link } from 'react-router';
import type { WorkflowListItem } from '../api.ts';
import { ChangeChips, summaryTitle } from './changes.tsx';
import { Status } from './ui.tsx';
import { cx, timeAgo } from '../util.ts';

export function WorkflowTable({ items, showInstance = true }: { items: WorkflowListItem[]; showInstance?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-dim">
            <th className="px-4 py-3 font-normal">Workflow</th>
            {showInstance && <th className="px-4 py-3 font-normal">Instanz</th>}
            <th className="px-4 py-3 font-normal">Status</th>
            <th className="px-4 py-3 font-normal text-right">Nodes</th>
            <th className="px-4 py-3 font-normal text-right">Versionen</th>
            <th className="px-4 py-3 font-normal">Letzte Änderung</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {items.map((w) => (
            <tr key={w.id} className={cx('group transition-colors hover:bg-panel-2', !!w.deleted_at && 'text-muted')}>
              <td className="max-w-[380px] px-4 py-3">
                <Link to={`/workflows/${w.id}`} className="block">
                  <div className="truncate font-medium group-hover:text-accent-hi">{w.name}</div>
                  {w.tags.length > 0 && (
                    <div className="mt-1 truncate font-mono text-xs text-dim">{w.tags.slice(0, 4).map((t) => `#${t}`).join(' ')}</div>
                  )}
                </Link>
              </td>
              {showInstance && (
                <td className="px-4 py-3">
                  <Link to={`/instances/${w.instance_id}`} className="flex items-center gap-2 text-[13px] text-muted hover:text-text">
                    <span className="size-2 shrink-0 rounded-[2px]" style={{ background: w.instance_color }} />
                    {w.instance_name}
                  </Link>
                </td>
              )}
              <td className="px-4 py-3">
                {w.deleted_at ? <Status tone="del">Gelöscht</Status> : w.archived ? <Status tone="neutral">Archiviert</Status> : w.active ? <Status tone="add">Aktiv</Status> : <Status tone="neutral">Inaktiv</Status>}
              </td>
              <td className="px-4 py-3 text-right font-mono text-[13px] text-muted">{w.node_count}</td>
              <td className="px-4 py-3 text-right">
                <Link to={`/workflows/${w.id}`} className="font-mono text-[13px] text-muted hover:text-text">{w.version_count}</Link>
              </td>
              <td className="px-4 py-3">
                <div className="flex items-baseline gap-3">
                  <span className="text-[13px]">{timeAgo(w.last_change_at)}</span>
                  {w.last_summary && <ChangeChips s={w.last_summary} compact />}
                </div>
                {w.last_summary && <div className="mt-0.5 max-w-[260px] truncate text-xs text-muted">{summaryTitle(w.last_summary)}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
