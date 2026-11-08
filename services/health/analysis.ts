/**
 * Reine Auswertung, ohne Datenbank und Netzwerk: Welche Version lief bei welcher
 * Ausführung, wie hoch ist die Fehlerquote pro Version, ist sie nach einer Änderung
 * gestiegen und auf welche Version sollte man zurück?
 */
import type { FailingNode, VersionHealth } from '../../shared/executions.ts';

export interface TimelineVersion {
  id: number;
  number: number;
  n8nVersionId: string | null;
  n8nUpdatedAt: string | null;
  createdAt: number;
}

export interface Exec {
  status: string;
  mode: string;
  startedAt: number;
  workflowVersionId: string | null;
  errorNode: string | null;
  errorMessage: string | null;
}

export interface AnalysisOptions {
  minRuns: number; // so viele abgeschlossene Läufe braucht eine Version, bevor sie bewertet wird
  thresholdPct: number; // Anstieg der Fehlerquote in Prozentpunkten, ab dem gewarnt wird
  includeManual: boolean; // Testläufe aus dem Editor mitzählen
}

export const DEFAULT_OPTIONS: AnalysisOptions = { minRuns: 5, thresholdPct: 20, includeManual: false };

const FAILED = new Set(['error', 'crashed']);
const COUNTED = new Set(['success', 'error', 'crashed']);
/** Wie viele Versionen zurück die Vergleichsbasis höchstens reicht. */
const BASELINE_DEPTH = 5;

/**
 * Ab wann lief welche Version? Maßgeblich ist der Speicherzeitpunkt in n8n (updatedAt),
 * nicht der Zeitpunkt der Sicherung – die kommt je nach Intervall später.
 * Die Zeitpunkte werden monoton gemacht, falls Uhren oder Wiederherstellungen querschießen.
 */
export function versionWindows(versions: TimelineVersion[]) {
  const sorted = [...versions].sort((a, b) => a.number - b.number);
  let prev = -Infinity;
  const starts = sorted.map((v) => {
    const t = v.n8nUpdatedAt ? Date.parse(v.n8nUpdatedAt) : NaN;
    const from = Math.max(Number.isFinite(t) ? t : v.createdAt, prev);
    prev = from;
    return from;
  });
  return sorted.map((v, i) => ({ version: v, from: starts[i], to: i + 1 < starts.length ? starts[i + 1] : null }));
}

/** Index der Version, unter der die Ausführung lief, oder -1 (vor der ersten Sicherung). */
export function attribute(
  windows: ReturnType<typeof versionWindows>,
  byN8nVersion: Map<string, number>,
  e: Pick<Exec, 'startedAt' | 'workflowVersionId'>,
): number {
  // Neuere n8n-Versionen nennen den ausgeführten Stand direkt – dann ist die Zuordnung exakt
  if (e.workflowVersionId) {
    const idx = byN8nVersion.get(e.workflowVersionId);
    if (idx !== undefined) return idx;
  }
  let lo = 0, hi = windows.length - 1, hit = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (windows[mid].from <= e.startedAt) {
      hit = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return hit;
}

interface Bucket {
  total: number;
  failed: number;
  canceled: number;
  nodes: Map<string, { failed: number; lastMessage: string | null; lastAt: number }>;
}

const rate = (failed: number, total: number) => (total ? failed / total : null);

export function analyze(versions: TimelineVersion[], execs: Exec[], opts: AnalysisOptions = DEFAULT_OPTIONS) {
  const windows = versionWindows(versions);
  const byN8nVersion = new Map<string, number>();
  windows.forEach((w, i) => w.version.n8nVersionId && byN8nVersion.set(w.version.n8nVersionId, i));

  const buckets: Bucket[] = windows.map(() => ({ total: 0, failed: 0, canceled: 0, nodes: new Map() }));
  let unattributed = 0;

  for (const e of execs) {
    if (!opts.includeManual && e.mode === 'manual') continue;
    if (e.status === 'canceled') {
      const i = attribute(windows, byN8nVersion, e);
      if (i >= 0) buckets[i].canceled++;
      continue;
    }
    if (!COUNTED.has(e.status)) continue; // läuft noch oder wartet
    const i = attribute(windows, byN8nVersion, e);
    if (i < 0) {
      unattributed++;
      continue;
    }
    const b = buckets[i];
    b.total++;
    if (FAILED.has(e.status)) {
      b.failed++;
      const name = e.errorNode ?? '';
      const n = b.nodes.get(name) ?? { failed: 0, lastMessage: null, lastAt: 0 };
      n.failed++;
      if (e.startedAt >= n.lastAt) {
        n.lastAt = e.startedAt;
        n.lastMessage = e.errorMessage ?? n.lastMessage;
      }
      b.nodes.set(name, n);
    }
  }

  const threshold = opts.thresholdPct / 100;

  const result: VersionHealth[] = windows.map((w, i) => {
    const b = buckets[i];

    // Vergleichsbasis: die Versionen davor, bis genug Läufe zusammenkommen
    let baseline: VersionHealth['baseline'] = null;
    const baseNodes = new Map<string, number>();
    let bt = 0, bf = 0, firstNo = 0;
    for (let j = i - 1; j >= 0 && j >= i - BASELINE_DEPTH; j--) {
      if (!buckets[j].total) continue;
      bt += buckets[j].total;
      bf += buckets[j].failed;
      firstNo = windows[j].version.number;
      for (const [name, n] of buckets[j].nodes) baseNodes.set(name, (baseNodes.get(name) ?? 0) + n.failed);
      if (bt >= opts.minRuns) break;
    }
    if (bt) baseline = { total: bt, failed: bf, rate: rate(bf, bt), fromNumber: firstNo, toNumber: windows[i - 1].version.number };

    const cur = rate(b.failed, b.total);
    const regression =
      cur !== null &&
      b.total >= opts.minRuns &&
      b.failed >= 2 &&
      !!baseline &&
      baseline.total >= opts.minRuns &&
      cur - (baseline.rate ?? 0) >= threshold;

    const failingNodes: FailingNode[] = [...b.nodes.entries()]
      .filter(([name]) => name)
      .map(([name, n]) => {
        const before = baseNodes.get(name) ?? 0;
        return {
          name,
          failed: n.failed,
          rate: n.failed / b.total,
          // „Neu“ nur mit belastbarer Basis: vorher höchstens in 2 % der Läufe an diesem Node gescheitert
          isNew: !!baseline && baseline.total >= opts.minRuns && before / baseline.total <= 0.02,
          lastMessage: n.lastMessage,
          lastAt: n.lastAt || null,
        };
      })
      .sort((a, b2) => b2.failed - a.failed);

    let rollback: VersionHealth['rollback'] = null;
    if (regression) {
      const limit = (baseline!.rate ?? 0) + threshold / 2;
      let pick = i - 1;
      for (let j = i - 1; j >= 0; j--) {
        const r = rate(buckets[j].failed, buckets[j].total);
        if (r !== null && r <= limit) {
          pick = j;
          break;
        }
      }
      const pv = windows[pick].version;
      rollback = { versionId: pv.id, number: pv.number, rate: rate(buckets[pick].failed, buckets[pick].total) };
    }

    return {
      versionId: w.version.id,
      number: w.version.number,
      from: w.from,
      to: w.to,
      total: b.total,
      failed: b.failed,
      canceled: b.canceled,
      rate: cur,
      failingNodes,
      baseline,
      regression,
      rollback,
    };
  });

  return { versions: result.reverse(), unattributed };
}
