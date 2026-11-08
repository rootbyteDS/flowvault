import { describeSummary, type ChangeSummary } from '../../shared/diff.ts';

const rtf = new Intl.RelativeTimeFormat('de', { numeric: 'auto' });

export function timeAgo(ts: number | null | undefined): string {
  if (!ts) return 'nie';
  const diff = (ts - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return 'gerade eben';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return formatDate(ts);
}

export function formatDate(ts: number | string | null | undefined, withTime = false): string {
  if (!ts) return '–';
  const d = new Date(ts);
  return d.toLocaleString('de-DE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function intervalLabel(min: number): string {
  if (!min) return 'Nur manuell';
  if (min < 60) return `Alle ${min} Min.`;
  if (min === 60) return 'Stündlich';
  if (min < 1440) return `Alle ${min / 60} Std.`;
  return 'Täglich';
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

/** Titel einer Version: KI-Text, falls vorhanden, sonst die regelbasierte Beschreibung. */
export function versionTitle(v: { summary: ChangeSummary; ai_summary?: { title: string } | null }) {
  return v.ai_summary?.title || describeSummary(v.summary);
}
