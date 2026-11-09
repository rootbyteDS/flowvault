import type { ChangeSummary } from '../../shared/diff.ts';
import { intlLocale, t } from './i18n.tsx';

const relative = new Map<string, Intl.RelativeTimeFormat>();
function rtf() {
  const tag = intlLocale();
  let f = relative.get(tag);
  if (!f) relative.set(tag, (f = new Intl.RelativeTimeFormat(tag, { numeric: 'auto' })));
  return f;
}

export function timeAgo(ts: number | null | undefined): string {
  if (!ts) return t('time.never');
  const diff = (ts - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return t('time.justNow');
  if (abs < 3600) return rtf().format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf().format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf().format(Math.round(diff / 86400), 'day');
  return formatDate(ts);
}

export function formatDate(ts: number | string | null | undefined, withTime = false): string {
  if (!ts) return '–';
  const d = new Date(ts);
  return d.toLocaleString(intlLocale(), {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

/** Zahl in der Schreibweise der aktiven Sprache. */
export const formatNumber = (n: number, opts?: Intl.NumberFormatOptions) => n.toLocaleString(intlLocale(), opts);

export function formatBytes(n: number): string {
  const one = { maximumFractionDigits: 1, minimumFractionDigits: 1 };
  if (n < 1024) return `${formatNumber(n)} B`;
  if (n < 1024 ** 2) return `${formatNumber(n / 1024, one)} KB`;
  if (n < 1024 ** 3) return `${formatNumber(n / 1024 ** 2, one)} MB`;
  return `${formatNumber(n / 1024 ** 3, { maximumFractionDigits: 2, minimumFractionDigits: 2 })} GB`;
}

export function intervalLabel(min: number): string {
  if (!min) return t('time.manualOnly');
  if (min < 60) return t('time.everyMinutes', { count: min });
  if (min === 60) return t('time.hourly');
  if (min < 1440) return t('time.everyHours', { count: min / 60 });
  return t('time.daily');
}

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

export function n8nWorkflowUrl(baseUrl: string, n8nId: string) {
  return `${baseUrl.replace(/\/$/, '')}/workflow/${n8nId}`;
}

export function shortType(type: string) {
  const last = type.split('.').pop() ?? type;
  return last.replace(/Trigger$/, ' Trigger').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
}

/** Kurzer, menschenlesbarer Titel für eine Version – wie eine Commit-Message. */
export function describeSummary(s: ChangeSummary): string {
  if (s.restoredFrom) return t('changes.restoredFrom', { version: s.restoredFrom });
  if (s.initial) return t('changes.initial', { count: s.nodeCount });
  const parts: string[] = [];
  if (s.nameChanged) parts.push(t('changes.renamedTo', { name: s.nameChanged.to }));
  if (s.activeChanged !== undefined) parts.push(t(s.activeChanged ? 'changes.activated' : 'changes.deactivated'));
  if (s.added.length) parts.push(t('changes.added', { count: s.added.length, name: s.added[0]! }));
  if (s.removed.length) parts.push(t('changes.removed', { count: s.removed.length, name: s.removed[0]! }));
  if (s.modified.length) parts.push(t('changes.modified', { count: s.modified.length, name: s.modified[0]! }));
  if (s.renamed.length) parts.push(t('changes.renamed', { count: s.renamed.length, from: s.renamed[0]!.from, to: s.renamed[0]!.to }));
  if (!parts.length && (s.connectionsAdded || s.connectionsRemoved)) parts.push(t('changes.connections'));
  if (!parts.length && s.settingsChanged) parts.push(t('changes.settings'));
  if (!parts.length && s.tagsChanged) parts.push(t('changes.tags'));
  if (!parts.length && s.pinDataChanged) parts.push(t('changes.pinData'));
  if (!parts.length && s.moved.length) parts.push(t('changes.layout'));
  if (!parts.length) parts.push(t('changes.minor'));
  return parts.slice(0, 3).join(' · ');
}

/** Titel einer Version: KI-Text, falls vorhanden, sonst die regelbasierte Beschreibung. */
export function versionTitle(v: { summary: ChangeSummary; ai_summary?: { title: string } | null }) {
  return v.ai_summary?.title || describeSummary(v.summary);
}
