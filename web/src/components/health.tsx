/**
 * Bausteine für die Fehlerquote pro Version: Anzeige pro Version, Warnungen, Rollback.
 *
 * Grundsatz: Jeder Zustand erklärt sich selbst. Statt „–“ oder nichts steht da, warum
 * es (noch) keine Zahl gibt und was man tun kann.
 */
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Activity, AlertTriangle, ChevronDown, CircleCheck, EyeOff, GitBranch, Hourglass, Info, RotateCcw, Scale, Settings2, TrendingDown } from 'lucide-react';
import { api, useApi, type FailingNode, type HealthAlert, type HealthSettings, type VersionHealth, type WorkflowHealth } from '../api.ts';
import { RestoreModal } from './RestoreModal.tsx';
import { Button, Card, InfoTip, useToast } from './ui.tsx';
import { cx, timeAgo } from '../util.ts';

export const pct = (r: number | null | undefined) => (r === null || r === undefined ? '–' : `${Math.round(r * 100)} %`);
const runs = (n: number) => `${n} ${n === 1 ? 'Lauf' : 'Läufe'}`;
const versionRange = (b: NonNullable<VersionHealth['baseline']>) => (b.fromNumber === b.toNumber ? `v${b.toNumber}` : `v${b.fromNumber} bis v${b.toNumber}`);

export const SETTINGS_LINK = '/settings#fehlerquote';

// ───────────────────────── Erklärungen ─────────────────────────

/** Übersetzt typische Abruffehler in einen Satz, mit dem man etwas anfangen kann. */
export function explainPollError(msg: string): { title: string; fix?: string } {
  if (/\b401\b|ungültig oder abgelaufen/i.test(msg)) return { title: 'Der API-Key wird von n8n abgelehnt', fix: 'Trag bei der Instanz einen gültigen API-Key ein.' };
  if (/\b403\b|forbidden|scope/i.test(msg))
    return { title: 'Der API-Key darf keine Ausführungen lesen', fix: 'Erstelle in n8n unter Settings → n8n API einen Key mit Lesezugriff auf Executions und trag ihn bei der Instanz ein.' };
  if (/nicht erreichbar|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|timeout/i.test(msg)) return { title: 'Die n8n-Instanz ist nicht erreichbar', fix: 'Läuft n8n und stimmt die URL? Der nächste Abruf versucht es automatisch erneut.' };
  return { title: msg };
}

/** Die drei Schritte in einem Satz pro Schritt, mit den tatsächlichen Einstellungen. */
export function HowItWorks({ s }: { s: HealthSettings }) {
  const steps: { icon: typeof Activity; title: string; text: ReactNode }[] = [
    {
      icon: Activity,
      title: 'Ausführungen abholen',
      text: <>Alle {s.pollMinutes} Min. fragt FlowVault bei n8n nach neuen Ausführungen. Gespeichert werden nur Status, Zeit und bei Fehlern der Node mit Meldung. Ein- und Ausgabedaten nie.</>,
    },
    {
      icon: GitBranch,
      title: 'Der Version zuordnen',
      text: <>Jede Ausführung zählt für die Version, die zu dem Zeitpunkt in n8n gespeichert war. So hat jede Version ihre eigene Fehlerquote.</>,
    },
    {
      icon: Scale,
      title: 'Mit vorher vergleichen',
      text: (
        <>
          Hat eine neue Version mindestens {runs(s.minRuns)} und liegt ihre Fehlerquote {s.thresholdPct} Prozentpunkte oder mehr über den Versionen davor,
          {s.alerts ? ' warnt FlowVault und schlägt die letzte stabile Version vor.' : ' wird sie markiert. Warnungen sind gerade aus.'} Zurückgesetzt wird nur auf deinen Klick.
        </>
      ),
    },
  ];
  return (
    <ol className="grid gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-3">
      {steps.map((st, i) => (
        <li key={st.title} className="bg-panel-2 p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <span className="flex size-5 items-center justify-center rounded-full bg-panel-3 font-mono text-[11px] text-muted">{i + 1}</span>
            {st.title}
          </div>
          <p className="mt-2 text-[13px] leading-5 text-muted">{st.text}</p>
        </li>
      ))}
    </ol>
  );
}

/** Aufklappbare Erklärung unter einer Zahl, damit die Zahl selbst ruhig bleiben kann. */
function Explainer({ label = 'Wie wird das berechnet?', children }: { label?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 text-xs text-dim transition-colors hover:text-text" aria-expanded={open}>
        <ChevronDown className={cx('size-3.5 transition-transform', !open && '-rotate-90')} />
        {label}
      </button>
      {open && <div className="mt-2 max-w-2xl animate-enter space-y-1.5 pl-5 text-xs leading-5 text-muted">{children}</div>}
    </div>
  );
}

function CalcExplainer({ h, wh }: { h: VersionHealth; wh: WorkflowHealth }) {
  const s = wh.settings;
  return (
    <Explainer>
      <p>
        <span className="text-text">Fehlerquote</span> = gescheiterte Läufe ÷ abgeschlossene Läufe dieser Version
        {s.includeManual ? '' : ', ohne Testläufe aus dem Editor'}. Abgebrochene und noch laufende Ausführungen zählen nicht.
      </p>
      <p>
        <span className="text-text">Vergleich</span>: die bis zu fünf Versionen davor zusammen, bis mindestens {runs(s.minRuns)} beisammen sind. Gewarnt wird ab{' '}
        {s.thresholdPct} Prozentpunkten Anstieg, z. B. von {Math.min(5, 100 - s.thresholdPct)} % auf {Math.min(5, 100 - s.thresholdPct) + s.thresholdPct} %.
      </p>
      <p>
        <span className="text-text">Zuordnung</span>: nach dem Speicherzeitpunkt in n8n. Speicherst du zwischen zwei Sicherungen mehrmals, zählen die Läufe dazwischen zur vorherigen gesicherten Version.
      </p>
      {wh.unattributed > 0 && h.number === Math.min(...wh.versions.map((v) => v.number)) && (
        <p>{runs(wh.unattributed)} fanden vor der ersten Sicherung statt und gehören zu keiner Version.</p>
      )}
      <p>
        Zuletzt abgerufen {timeAgo(wh.lastPollAt)}.{' '}
        <Link to={SETTINGS_LINK} className="underline decoration-line-2 underline-offset-2 hover:text-text">Schwellenwerte ändern</Link>
      </p>
    </Explainer>
  );
}

// ───────────────────────── Timeline ─────────────────────────

/** Kompakte Fehlerquote in der Versions-Timeline. */
export function HealthPill({ h, minRuns }: { h?: VersionHealth; minRuns?: number }) {
  if (!h || !h.total) return null;
  const early = minRuns !== undefined && h.total < minRuns;
  const tone = h.regression ? 'text-del' : h.failed ? 'text-mod' : 'text-dim';
  const tip = `${h.failed} von ${runs(h.total)} mit dieser Version fehlgeschlagen${early ? ` (vorläufig, bewertet wird ab ${minRuns})` : ''}${h.regression ? '. Deutlich mehr als vorher.' : ''}`;
  return (
    <span className={cx('inline-flex items-center gap-1.5 font-mono text-xs', tone)} title={tip}>
      {h.regression && <AlertTriangle className="size-3.5" />}
      {pct(h.rate)} Fehler
      <span className="text-dim">
        · {runs(h.total)}
        {early && ' · vorläufig'}
      </span>
    </span>
  );
}

// ───────────────────────── Versionsansicht ─────────────────────────

function NodeList({ nodes }: { nodes: FailingNode[] }) {
  if (!nodes.length) return null;
  return (
    <div className="mt-4">
      <div className="flex items-center gap-1.5 text-xs text-dim">
        Wo es scheitert
        <InfoTip label="Wo es scheitert">
          <p>Der Node, an dem die Ausführung abgebrochen ist, mit der letzten Fehlermeldung aus n8n. Die Prozentzahl bezieht sich auf alle Läufe dieser Version.</p>
          <p>Details holt FlowVault für höchstens 200 Fehler pro Abruf. Bei sehr vielen Fehlern können die Zahlen pro Node daher etwas niedriger sein als die Gesamtquote.</p>
        </InfoTip>
      </div>
      <ul className="mt-2 space-y-2.5">
        {nodes.slice(0, 4).map((n) => (
          <li key={n.name} className="text-sm">
            <span className="font-medium">„{n.name}“</span>
            <span className="text-muted"> in {pct(n.rate)} der Läufe ({n.failed}×)</span>
            {n.isNew && (
              <span className="ml-2 inline-flex items-center gap-1 rounded bg-del/12 px-1.5 py-0.5 text-xs text-del">
                neu seit dieser Version
                <InfoTip label="neu seit dieser Version" className="text-del/70 hover:text-del">
                  <p>In den Versionen davor ist dieser Node fast nie gescheitert, in höchstens 2 % der Läufe.</p>
                  <p>Ein starker Hinweis, dass die Änderung in dieser Version die Ursache ist. Schau dir im Tab „Änderungen“ an, was an diesem Node anders ist.</p>
                </InfoTip>
              </span>
            )}
            {n.lastMessage && <div className="mt-0.5 truncate font-mono text-xs text-dim" title={n.lastMessage}>{n.lastMessage}</div>}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-dim">Auf dem Canvas sind diese Nodes rot umrandet.</p>
    </div>
  );
}

/** Ruhige Zeile für Zustände ohne Zahl: Icon, Satz, optional Hinweis und Link. */
function Notice({ icon: Icon, children, hint, tone = 'dim' }: { icon: typeof Info; children: ReactNode; hint?: ReactNode; tone?: 'dim' | 'del' }) {
  return (
    <div className="mt-4 flex items-start gap-2.5 border-t border-line pt-4 text-sm">
      <Icon className={cx('mt-0.5 size-4 shrink-0', tone === 'del' ? 'text-del' : 'text-dim')} />
      <div className="min-w-0">
        <div className={tone === 'del' ? 'text-del' : 'text-muted'}>{children}</div>
        {hint && <div className="mt-1 text-xs leading-5 text-dim">{hint}</div>}
      </div>
    </div>
  );
}

const settingsLink = (label: string) => (
  <Link to={SETTINGS_LINK} className="inline-flex items-center gap-1 text-muted underline decoration-line-2 underline-offset-2 hover:text-text">
    <Settings2 className="size-3" />
    {label}
  </Link>
);

/**
 * Betrieb der gewählten Version im Kopf der Versionsansicht. Deckt alle Zustände ab:
 * Auswertung nicht erreichbar, ausgeschaltet, Abruffehler, noch nie abgerufen,
 * keine Läufe, zu wenige Läufe, keine Vergleichsbasis, unauffällig, Anstieg.
 */
export function VersionHealthPanel({ h, wh, unavailable, workflowActive, onRollback }: {
  h?: VersionHealth;
  wh?: WorkflowHealth;
  unavailable?: boolean;
  workflowActive: boolean;
  onRollback: (versionId: number, number: number) => void;
}) {
  if (unavailable) {
    return (
      <Notice icon={Info} hint={<>FlowVault startet die Auswertung automatisch neu. Versionen, Vergleich und Wiederherstellen funktionieren weiter.</>}>
        Fehlerquote gerade nicht verfügbar
      </Notice>
    );
  }
  if (!wh || !h) return null;
  const s = wh.settings;

  if (!s.enabled) {
    return <Notice icon={Activity} hint={<>Zeigt pro Version, wie oft der Workflow in n8n gescheitert ist. {settingsLink('Einschalten')}</>}>Fehlerquote pro Version ist ausgeschaltet</Notice>;
  }
  if (wh.pollError) {
    const e = explainPollError(wh.pollError);
    return (
      <Notice icon={AlertTriangle} tone="del" hint={<>{e.fix} {wh.lastPollAt ? `Letzter erfolgreicher Stand ${timeAgo(wh.lastPollAt)}.` : ''}</>}>
        Ausführungen konnten nicht abgerufen werden: {e.title}
      </Notice>
    );
  }
  if (!wh.lastPollAt) {
    return <Notice icon={Hourglass} hint="Das dauert meist unter einer Minute. Die Seite aktualisiert sich von selbst.">FlowVault holt gerade zum ersten Mal die Ausführungen aus n8n</Notice>;
  }

  if (!h.total) {
    const why = [
      !workflowActive && !h.to ? 'Der Workflow ist in n8n nicht aktiv.' : null,
      !s.includeManual ? 'Testläufe aus dem Editor zählen nicht mit.' : null,
      `Abgerufen werden Ausführungen der letzten ${s.lookbackDays} Tage, sofern n8n sie noch hat.`,
    ].filter(Boolean);
    return (
      <Notice icon={Activity} hint={why.join(' ')}>
        {h.to ? `Solange v${h.number} aktuell war, gab es keine gezählten Läufe` : `Mit v${h.number} gab es noch keine gezählten Läufe`}
      </Notice>
    );
  }

  const early = h.total < s.minRuns;
  const noBase = !h.baseline || h.baseline.total < s.minRuns;
  const delta = h.baseline && h.rate !== null && h.baseline.rate !== null ? h.rate - h.baseline.rate : null;

  let verdict: ReactNode;
  if (h.regression) verdict = null;
  else if (early)
    verdict = (
      <>
        Vorläufig: erst {h.total} von {s.minRuns} Läufen. Ab {s.minRuns} vergleicht FlowVault mit den Versionen davor.{' '}
        <InfoTip label="Vorläufig">
          <p>Bei wenigen Läufen schwankt die Quote stark: Ein Fehler bei 2 Läufen sind schon 50 %.</p>
          <p>Deshalb gibt es erst ab {runs(s.minRuns)} eine Bewertung und eine mögliche Warnung. Die Grenze stellst du in den Einstellungen ein.</p>
        </InfoTip>
      </>
    );
  else if (noBase)
    verdict = (
      <>
        Kein Vergleich möglich: Vor v{h.number} gab es zu wenige gezählte Läufe.{' '}
        <InfoTip label="Kein Vergleich möglich">
          <p>Für einen Vergleich brauchen auch die Versionen davor zusammen mindestens {runs(s.minRuns)}.</p>
          <p>Das passiert bei der ersten Version, bei selten laufenden Workflows oder wenn n8n ältere Ausführungen schon gelöscht hat.</p>
        </InfoTip>
      </>
    );
  else if (delta !== null && delta <= -0.05) verdict = <span className="inline-flex items-center gap-1.5"><TrendingDown className="size-3.5 text-add" />Weniger Fehler als vorher.</span>;
  else if (delta !== null && delta >= 0.05) verdict = <>Etwas mehr Fehler als vorher, aber unter der Warnschwelle von {s.thresholdPct} Prozentpunkten.</>;
  else verdict = <span className="inline-flex items-center gap-1.5"><CircleCheck className="size-3.5 text-add" />Unauffällig, ungefähr wie vorher.</span>;

  return (
    <div className={cx('mt-4', h.regression ? 'rounded-lg border border-del/30 bg-del/8 px-4 py-3' : 'border-t border-line pt-4')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5 text-sm">
          {h.regression ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-del" /> : <Activity className="mt-0.5 size-4 shrink-0 text-dim" />}
          <div className="min-w-0">
            <div>
              {h.regression ? (
                <span className="font-medium text-del">Seit v{h.number} schlagen {pct(h.rate)} der Läufe fehl</span>
              ) : (
                <span className={h.failed ? 'text-text' : 'text-muted'}>{pct(h.rate)} der Läufe fehlgeschlagen</span>
              )}{' '}
              <InfoTip label="Fehlerquote">
                <p><b>Fehlerquote</b> = gescheiterte ÷ abgeschlossene Läufe, solange diese Version in n8n aktuell war.</p>
                <p>
                  {s.includeManual ? 'Testläufe aus dem Editor zählen mit.' : 'Testläufe aus dem Editor zählen nicht mit.'} Abgebrochene und noch laufende Ausführungen
                  zählen nicht.
                </p>
              </InfoTip>
              {h.baseline && !early && (
                <span className="text-muted">
                  , vorher {pct(h.baseline.rate)} ({versionRange(h.baseline)}){' '}
                  <InfoTip label="Vergleich mit vorher">
                    <p><b>Vergleichsbasis</b>: die Versionen direkt davor, zusammengenommen, bis mindestens {runs(s.minRuns)} beisammen sind. Höchstens fünf Versionen zurück.</p>
                    <p>Hier: {versionRange(h.baseline)} mit {runs(h.baseline.total)}, davon {h.baseline.failed} gescheitert.</p>
                  </InfoTip>
                </span>
              )}
              <span className="ml-2 font-mono text-xs text-dim">
                {h.failed}/{runs(h.total)}
                {h.canceled ? ` · ${h.canceled} abgebrochen` : ''}
              </span>
              {h.canceled > 0 && (
                <InfoTip label="abgebrochen" className="ml-1">
                  <p>Von Hand gestoppte Ausführungen. Sie zählen weder als Erfolg noch als Fehler.</p>
                </InfoTip>
              )}
            </div>
            {verdict && <div className="mt-1 text-[13px] text-muted">{verdict}</div>}
            {h.regression && h.rollback && (
              <div className="mt-1 text-[13px] text-muted">
                v{h.rollback.number} ist die letzte Version, die stabil lief ({pct(h.rollback.rate)} Fehler). Zurücksetzen spielt sie in n8n ein, der jetzige Stand bleibt hier gesichert.{' '}
                <InfoTip label="Rollback-Vorschlag">
                  <p>FlowVault sucht rückwärts die jüngste Version, deren Fehlerquote nah an der Zeit vor der Änderung lag.</p>
                  <p>Beim Klick siehst du vorher noch einmal, was passiert: überschreiben oder als Kopie anlegen. Danach entsteht eine neue Version, die Historie bleibt komplett.</p>
                </InfoTip>
              </div>
            )}
          </div>
        </div>
        {h.rollback && (
          <Button size="sm" variant="primary" icon={<RotateCcw className="size-4" />} onClick={() => onRollback(h.rollback!.versionId, h.rollback!.number)}>
            Auf v{h.rollback.number} zurücksetzen
          </Button>
        )}
      </div>
      <NodeList nodes={h.failingNodes} />
      <CalcExplainer h={h} wh={wh} />
    </div>
  );
}

// ───────────────────────── Warnungen ─────────────────────────

const DISMISS_TIP = 'Blendet die Warnung für diese Version aus. Steigt die Fehlerquote einer späteren Version, warnt FlowVault erneut.';

/** Warnung oben auf der Workflow-Seite, wenn die aktuelle Version auffällig ist. */
export function AlertBanner({ alert, settings, onShow, onRollback, onDismissed }: {
  alert: HealthAlert;
  settings?: HealthSettings;
  onShow: () => void;
  onRollback: (versionId: number, number: number) => void;
  onDismissed: () => void;
}) {
  const toast = useToast();
  const node = alert.failingNodes[0];
  return (
    <div className="mb-6 rounded-xl border border-del/30 bg-del/8 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-del" />
          <div className="min-w-0">
            <div className="font-medium">
              Seit der Änderung in v{alert.versionNumber} scheitert dieser Workflow deutlich öfter{' '}
              <InfoTip label="Warum diese Warnung?">
                <p>
                  FlowVault vergleicht die Fehlerquote der aktuellen Version mit den Versionen davor.
                  {settings && <> Liegt sie nach mindestens {runs(settings.minRuns)} um {settings.thresholdPct} Prozentpunkte oder mehr darüber, erscheint diese Warnung.</>}
                </p>
                <p>Die Warnung verschwindet von selbst, sobald eine neuere Version wieder normal läuft oder du zurücksetzt.</p>
                <p><Link to={SETTINGS_LINK} className="underline underline-offset-2 hover:text-text">Schwellenwerte ändern</Link></p>
              </InfoTip>
            </div>
            <div className="mt-1 text-sm text-muted">
              {pct(alert.rate)} der Läufe schlagen fehl ({alert.failed} von {alert.total}), vorher waren es {pct(alert.baselineRate)}
              {node ? <>. Meist scheitert „{node.name}“</> : null}. Erkannt {timeAgo(alert.createdAt)}.
            </div>
            <div className="mt-2 text-[13px] text-dim">
              Sieh dir an, was sich in v{alert.versionNumber} geändert hat.
              {alert.rollbackNumber ? ` Wenn es eilt: v${alert.rollbackNumber} lief zuletzt stabil.` : ''}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" icon={<EyeOff className="size-4" />} title={DISMISS_TIP} onClick={async () => {
            await api(`/health/alerts/${alert.id}/dismiss`, { method: 'POST' });
            toast(`Warnung für v${alert.versionNumber} ausgeblendet`);
            onDismissed();
          }}>Ausblenden</Button>
          <Button size="sm" onClick={onShow}>Änderung ansehen</Button>
          {alert.rollbackVersionId && (
            <Button size="sm" variant="primary" icon={<RotateCcw className="size-4" />} onClick={() => onRollback(alert.rollbackVersionId!, alert.rollbackNumber!)}>
              Auf v{alert.rollbackNumber} zurücksetzen
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Übersicht: alle offenen Warnungen. Ohne Auswertung oder ohne Warnungen unsichtbar. */
export function AlertsCard() {
  const alerts = useApi<HealthAlert[]>('/health/alerts', { poll: () => 60_000 });
  const [rollback, setRollback] = useState<{ alert: HealthAlert } | null>(null);
  const toast = useToast();
  const list = alerts.data ?? [];
  if (!list.length) return null;

  return (
    <Card className="mb-6 border-del/30">
      <div className="border-b border-line px-4 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="size-4 text-del" />
            {list.length === 1 ? 'Ein Workflow scheitert seit einer Änderung öfter' : `${list.length} Workflows scheitern seit einer Änderung öfter`}
          </h2>
          <Link to={SETTINGS_LINK} className="shrink-0 text-xs text-dim transition-colors hover:text-text">Wie wird das erkannt?</Link>
        </div>
        <p className="mt-1 text-[13px] text-muted">Die Fehlerquote der aktuellen Version liegt deutlich über der vorherigen. Öffne den Workflow, um die Änderung zu sehen.</p>
      </div>
      <div className="divide-y divide-line">
        {list.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <Link to={`/workflows/${a.workflowId}?v=${a.versionId}`} className="min-w-0 flex-1 hover:text-text">
              <div className="truncate text-sm font-medium">{a.workflowName}</div>
              <div className="mt-0.5 truncate text-[13px] text-muted">
                {a.instanceName} · seit v{a.versionNumber}: <span className="text-del">{pct(a.rate)}</span> Fehler statt {pct(a.baselineRate)}
                {a.failingNodes[0] && <> · meist „{a.failingNodes[0].name}“</>}
              </div>
            </Link>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" title={DISMISS_TIP} onClick={async () => {
                await api(`/health/alerts/${a.id}/dismiss`, { method: 'POST' });
                toast('Warnung ausgeblendet');
                alerts.reload();
              }}>Ausblenden</Button>
              {a.rollbackVersionId && (
                <Button size="sm" icon={<RotateCcw className="size-4" />} title={`v${a.rollbackNumber} lief zuletzt stabil`} onClick={() => setRollback({ alert: a })}>
                  Auf v{a.rollbackNumber} zurücksetzen
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
      {rollback && (
        <RestoreModal
          open
          onClose={() => setRollback(null)}
          versionId={rollback.alert.rollbackVersionId!}
          versionNumber={rollback.alert.rollbackNumber!}
          workflowName={rollback.alert.workflowName}
          instanceId={rollback.alert.instanceId}
          deleted={false}
          onDone={() => alerts.reload()}
        />
      )}
    </Card>
  );
}
