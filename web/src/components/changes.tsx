import { Link } from 'react-router';
import {
  Bot, Braces, Circle, Clock, Code, Database, FileText, Filter, GitBranch, Globe, Layers, Mail, Merge, MessageSquare, Pencil,
  Repeat, Send, Split, StickyNote, Table, Webhook, Zap, Plus, Trash2, RotateCcw, AlertTriangle, ArrowRightLeft, GitCommitHorizontal,
  type LucideIcon,
} from 'lucide-react';
import { describeSummary, type ChangeSummary } from '../../../shared/diff.ts';
import type { ActivityItem } from '../api.ts';
import { cx, timeAgo } from '../util.ts';

/**
 * Erkennungsmerkmal von FlowVault: der Änderungszähler im Git-Stil.
 * Überall gleich – Timeline, Feed, Tabellen, Vergleich.
 */
export function ChangeChips({ s, compact }: { s: ChangeSummary; compact?: boolean }) {
  if (s.initial) return <span className="font-mono text-xs text-dim">initial</span>;
  const edges = s.connectionsAdded + s.connectionsRemoved;
  const parts: [string, string][] = [];
  if (s.added.length) parts.push([`+${s.added.length}`, 'text-add']);
  if (s.modified.length) parts.push([`~${s.modified.length}`, 'text-mod']);
  if (s.removed.length) parts.push([`−${s.removed.length}`, 'text-del']);
  if (!compact && edges) parts.push([`⇄${edges}`, 'text-dim']);
  if (!parts.length) return null;
  return (
    <span className="inline-flex items-center gap-2 font-mono text-xs">
      {parts.map(([t, c]) => (
        <span key={t} className={c}>{t}</span>
      ))}
    </span>
  );
}

export function summaryTitle(s: ChangeSummary) {
  return describeSummary(s);
}

const ICONS: [RegExp, LucideIcon, string][] = [
  [/stickyNote/i, StickyNote, '#a3a8b2'],
  [/agent|openAi|anthropic|lmChat|langchain|gemini|mistral|ollama/i, Bot, '#b49ae8'],
  [/webhook|respondToWebhook/i, Webhook, '#e39a70'],
  [/schedule|cron|interval/i, Clock, '#d9b44a'],
  [/httpRequest|graphql/i, Globe, '#8aaed9'],
  [/\.code$|function|executeCommand/i, Code, '#e39a70'],
  [/\.if$|switch|router/i, Split, '#4cc38a'],
  [/filter/i, Filter, '#4cc38a'],
  [/merge/i, Merge, '#5fbfb3'],
  [/\.set$|editFields|rename/i, Pencil, '#8aaed9'],
  [/splitInBatches|loop/i, Repeat, '#c99ad6'],
  [/postgres|mysql|mongo|redis|supabase|sqlite|database|microsoftSql/i, Database, '#8aaed9'],
  [/sheets|airtable|baserow|notion|table/i, Table, '#4cc38a'],
  [/email|gmail|outlook|imap|mail/i, Mail, '#d98aa6'],
  [/slack|telegram|discord|teams|whatsapp|mattermost/i, MessageSquare, '#b49ae8'],
  [/json|xml|html|markdown|extract|convert/i, Braces, '#d9b44a'],
  [/file|pdf|ftp|drive|s3|dropbox/i, FileText, '#a3a8b2'],
  [/executeWorkflow|subworkflow/i, GitBranch, '#e39a70'],
  [/send|sms|twilio/i, Send, '#b49ae8'],
  [/trigger/i, Zap, '#d9b44a'],
  [/vector|embedding|retriever/i, Layers, '#b49ae8'],
];

/** Node-Icons tragen nur auf der Canvas Farbe – wie in n8n selbst. */
export function nodeVisual(type: string): { Icon: LucideIcon; color: string; trigger: boolean } {
  const trigger = /trigger|webhook$|\.webhook|schedule|cron/i.test(type) && !/respondToWebhook/i.test(type);
  for (const [re, Icon, color] of ICONS) if (re.test(type)) return { Icon, color, trigger };
  return { Icon: Circle, color: '#a3a8b2', trigger };
}

const KIND: Record<ActivityItem['kind'], { Icon: LucideIcon; label: string; tone?: string }> = {
  created: { Icon: Plus, label: 'Neu gesichert' },
  changed: { Icon: GitCommitHorizontal, label: '' },
  restored: { Icon: RotateCcw, label: '' },
  promoted: { Icon: ArrowRightLeft, label: 'In andere Umgebung übernommen' },
  deleted: { Icon: Trash2, label: 'In n8n gelöscht', tone: 'text-del' },
  sync_error: { Icon: AlertTriangle, label: 'Sync fehlgeschlagen', tone: 'text-del' },
};

export function ActivityRow({ a }: { a: ActivityItem }) {
  const k = KIND[a.kind];
  const title = a.ai_summary?.title ?? (a.summary ? describeSummary(a.summary) : k.label);
  const href = a.version_id ? `/workflows/${a.workflow_id}?v=${a.version_id}` : a.workflow_id ? `/workflows/${a.workflow_id}` : `/instances/${a.instance_id}`;
  return (
    <Link to={href} className="group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-panel-2">
      <k.Icon className={cx('mt-0.5 size-4 shrink-0', k.tone ?? 'text-dim')} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-medium">{a.workflow_name ?? a.instance_name}</span>
          {a.version_number && <span className="font-mono text-xs text-dim">v{a.version_number}</span>}
          {a.summary && <ChangeChips s={a.summary} compact />}
        </div>
        <div className={cx('mt-0.5 truncate text-[13px]', k.tone ?? 'text-muted')}>
          {a.message && <span className="text-text">{a.message} · </span>}
          {a.kind === 'sync_error' ? a.detail : title}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-xs text-dim">{timeAgo(a.created_at)}</span>
        {a.instance_name && (
          <span className="flex items-center gap-1.5 text-xs text-dim">
            <span className="size-1.5 rounded-[2px]" style={{ background: a.instance_color ?? undefined }} />
            {a.instance_name}
          </span>
        )}
      </div>
    </Link>
  );
}
