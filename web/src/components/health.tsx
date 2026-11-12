/**
 * Bausteine für die Fehlerquote pro Version: Anzeige pro Version, Warnungen, Rollback.
 *
 * Grundsatz: Jeder Zustand erklärt sich selbst. Statt „–“ oder nichts steht da, warum
 * es (noch) keine Zahl gibt und was man tun kann.
 */
import { WidgetHeader, type WidgetControls } from './dashboard/WidgetHeader.tsx';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Activity, AlertTriangle, ChevronDown, CircleCheck, EyeOff, GitBranch, Hourglass, Info, RotateCcw, Scale, Settings2, TrendingDown } from 'lucide-react';
import { api, useApi, type FailingNode, type HealthAlert, type HealthSettings, type VersionHealth, type WorkflowHealth } from '../api.ts';
import { RestoreModal } from './RestoreModal.tsx';
import { Button, Card, InfoTip, useToast } from './ui.tsx';
import { cx, timeAgo } from '../util.ts';
import { message, paragraphs, rich, t } from '../i18n.tsx';
import { unpackMessage } from '../../../shared/i18n/index.ts';

export const pct = (r: number | null | undefined) => (r === null || r === undefined ? '–' : `${Math.round(r * 100)} %`);
const runs = (n: number) => t('health.runs', { count: n });
const versionRange = (b: NonNullable<VersionHealth['baseline']>) =>
  b.fromNumber === b.toNumber ? t('health.range.single', { to: b.toNumber }) : t('health.range.span', { from: b.fromNumber, to: b.toNumber });
/** Kleine Hervorhebung im Fließtext (Tag `<h>`). */
const em = (c: string) => <span className="text-text">{c}</span>;

export const SETTINGS_LINK = '/settings#fehlerquote';

// ───────────────────────── Erklärungen ─────────────────────────

/** Übersetzt typische Abruffehler in einen Satz, mit dem man etwas anfangen kann. */
export function explainPollError(msg: string): { title: string; fix?: string } {
  // Neue Meldungen kommen als Schlüssel vom Server; ältere (und wörtliche von n8n) als Text
  const key = unpackMessage(msg)?.key;
  if (key === 'errors.n8n.keyInvalid' || /\b401\b|ungültig oder abgelaufen|invalid or expired/i.test(msg))
    return { title: t('health.pollError.unauthorized'), fix: t('health.pollError.unauthorizedFix') };
  if (/\b403\b|forbidden|scope/i.test(msg)) return { title: t('health.pollError.forbidden'), fix: t('health.pollError.forbiddenFix') };
  if (key === 'errors.n8n.unreachable' || /nicht erreichbar|not reachable|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|timeout/i.test(msg))
    return { title: t('health.pollError.unreachable'), fix: t('health.pollError.unreachableFix') };
  return { title: message(msg) };
}

/** Die drei Schritte in einem Satz pro Schritt, mit den tatsächlichen Einstellungen. */
export function HowItWorks({ s }: { s: HealthSettings }) {
  const steps: { icon: typeof Activity; title: string; text: ReactNode }[] = [
    {
      icon: Activity,
      title: t('health.steps.fetch'),
      text: t('health.steps.fetchText', { minutes: s.pollMinutes }),
    },
    {
      icon: GitBranch,
      title: t('health.steps.assign'),
      text: t('health.steps.assignText'),
    },
    {
      icon: Scale,
      title: t('health.steps.compare'),
      text: t(s.alerts ? 'health.steps.compareOn' : 'health.steps.compareOff', { runs: runs(s.minRuns), threshold: s.thresholdPct }),
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
function Explainer({ label = t('health.explainer.label'), children }: { label?: string; children: ReactNode }) {
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
      <p>{rich(s.includeManual ? 'health.explainer.rateWithManual' : 'health.explainer.rateWithoutManual', { h: em })}</p>
      <p>
        {rich('health.explainer.compare', { h: em }, {
          runs: runs(s.minRuns), threshold: s.thresholdPct, from: Math.min(5, 100 - s.thresholdPct), to: Math.min(5, 100 - s.thresholdPct) + s.thresholdPct,
        })}
      </p>
      <p>{rich('health.explainer.assign', { h: em })}</p>
      {wh.unattributed > 0 && h.number === Math.min(...wh.versions.map((v) => v.number)) && (
        <p>{t('health.explainer.unattributed', { count: wh.unattributed })}</p>
      )}
      <p>
        {t('health.explainer.lastPoll', { when: timeAgo(wh.lastPollAt) })}{' '}
        <Link to={SETTINGS_LINK} className="underline decoration-line-2 underline-offset-2 hover:text-text">{t('health.explainer.changeThresholds')}</Link>
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
  const tip = `${t('health.pill.tip', { count: h.total, failed: h.failed, total: h.total })}${early ? t('health.pill.early', { min: minRuns }) : ''}${h.regression ? t('health.pill.regression') : ''}`;
  return (
    <span className={cx('inline-flex items-center gap-1.5 font-mono text-xs', tone)} title={tip}>
      {h.regression && <AlertTriangle className="size-3.5" />}
      {t('health.pill.errors', { rate: pct(h.rate) })}
      <span className="text-dim">
        · {runs(h.total)}
        {early && ` · ${t('health.pill.provisional')}`}
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
        {t('health.nodes.where')}
        <InfoTip label={t('health.nodes.where')}>{paragraphs('health.nodes.whereTip')}</InfoTip>
      </div>
      <ul className="mt-2 space-y-2.5">
        {nodes.slice(0, 4).map((n) => (
          <li key={n.name} className="text-sm">
            {rich('health.nodes.line', { n: (c) => <span className="font-medium">{c}</span>, m: (c) => <span className="text-muted">{c}</span> }, { name: n.name, rate: pct(n.rate), failed: n.failed })}
            {n.isNew && (
              <span className="ml-2 inline-flex items-center gap-1 rounded bg-del/12 px-1.5 py-0.5 text-xs text-del">
                {t('health.nodes.isNew')}
                <InfoTip label={t('health.nodes.isNew')} className="text-del/70 hover:text-del">{paragraphs('health.nodes.isNewTip')}</InfoTip>
              </span>
            )}
            {n.lastMessage && <div className="mt-0.5 truncate font-mono text-xs text-dim" title={n.lastMessage}>{n.lastMessage}</div>}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-dim">{t('health.nodes.canvas')}</p>
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
      <Notice icon={Info} hint={t('health.panel.unavailableHint')}>
        {t('health.panel.unavailable')}
      </Notice>
    );
  }
  if (!wh || !h) return null;
  const s = wh.settings;

  if (!s.enabled) {
    return <Notice icon={Activity} hint={rich('health.panel.disabledHint', { link: settingsLink })}>{t('health.panel.disabled')}</Notice>;
  }
  if (wh.pollError) {
    const e = explainPollError(wh.pollError);
    return (
      <Notice icon={AlertTriangle} tone="del" hint={<>{e.fix} {wh.lastPollAt ? t('health.panel.lastGood', { when: timeAgo(wh.lastPollAt) }) : ''}</>}>
        {t('health.panel.pollFailed', { reason: e.title })}
      </Notice>
    );
  }
  if (!wh.lastPollAt) {
    return <Notice icon={Hourglass} hint={t('health.panel.firstPollHint')}>{t('health.panel.firstPoll')}</Notice>;
  }

  if (!h.total) {
    const why = [
      !workflowActive && !h.to ? t('health.panel.whyInactive') : null,
      !s.includeManual ? t('health.panel.whyManual') : null,
      t('health.panel.whyLookback', { days: s.lookbackDays }),
    ].filter(Boolean);
    return (
      <Notice icon={Activity} hint={why.join(' ')}>
        {t(h.to ? 'health.panel.noRunsPast' : 'health.panel.noRunsYet', { number: h.number })}
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
        {t('health.panel.provisional', { total: h.total, min: s.minRuns })}{' '}
        <InfoTip label={t('health.panel.provisionalLabel')}>{paragraphs('health.panel.provisionalTip', { runs: runs(s.minRuns) })}</InfoTip>
      </>
    );
  else if (noBase)
    verdict = (
      <>
        {t('health.panel.noBase', { number: h.number })}{' '}
        <InfoTip label={t('health.panel.noBaseLabel')}>{paragraphs('health.panel.noBaseTip', { runs: runs(s.minRuns) })}</InfoTip>
      </>
    );
  else if (delta !== null && delta <= -0.05) verdict = <span className="inline-flex items-center gap-1.5"><TrendingDown className="size-3.5 text-add" />{t('health.panel.fewer')}</span>;
  else if (delta !== null && delta >= 0.05) verdict = <>{t('health.panel.slightlyMore', { threshold: s.thresholdPct })}</>;
  else verdict = <span className="inline-flex items-center gap-1.5"><CircleCheck className="size-3.5 text-add" />{t('health.panel.same')}</span>;

  return (
    <div className={cx('mt-4', h.regression ? 'rounded-lg border border-del/30 bg-del/8 px-4 py-3' : 'border-t border-line pt-4')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5 text-sm">
          {h.regression ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-del" /> : <Activity className="mt-0.5 size-4 shrink-0 text-dim" />}
          <div className="min-w-0">
            <div>
              {h.regression ? (
                <span className="font-medium text-del">{t('health.panel.since', { number: h.number, rate: pct(h.rate) })}</span>
              ) : (
                <span className={h.failed ? 'text-text' : 'text-muted'}>{t('health.panel.failedShare', { rate: pct(h.rate) })}</span>
              )}{' '}
              <InfoTip label={t('health.panel.rateLabel')}>
                {paragraphs('health.panel.rateTip', { manual: t(s.includeManual ? 'health.panel.manualCounted' : 'health.panel.manualNotCounted') })}
              </InfoTip>
              {h.baseline && !early && (
                <span className="text-muted">
                  {t('health.panel.before', { rate: pct(h.baseline.rate), range: versionRange(h.baseline) })}{' '}
                  <InfoTip label={t('health.panel.beforeLabel')}>
                    {paragraphs('health.panel.beforeTip', { runs: runs(s.minRuns), range: versionRange(h.baseline), total: runs(h.baseline.total), failed: h.baseline.failed })}
                  </InfoTip>
                </span>
              )}
              <span className="ml-2 font-mono text-xs text-dim">
                {t('health.panel.counts', { failed: h.failed, runs: runs(h.total) })}
                {h.canceled ? t('health.panel.canceledSuffix', { count: h.canceled }) : ''}
              </span>
              {h.canceled > 0 && (
                <InfoTip label={t('health.panel.canceledLabel')} className="ml-1">
                  <p>{t('health.panel.canceledTip')}</p>
                </InfoTip>
              )}
            </div>
            {verdict && <div className="mt-1 text-[13px] text-muted">{verdict}</div>}
            {h.regression && h.rollback && (
              <div className="mt-1 text-[13px] text-muted">
                {t('health.panel.rollbackHint', { number: h.rollback.number, rate: pct(h.rollback.rate) })}{' '}
                <InfoTip label={t('health.panel.rollbackLabel')}>{paragraphs('health.panel.rollbackTip')}</InfoTip>
              </div>
            )}
          </div>
        </div>
        {h.rollback && (
          <Button size="sm" variant="primary" icon={<RotateCcw className="size-4" />} onClick={() => onRollback(h.rollback!.versionId, h.rollback!.number)}>
            {t('health.panel.rollbackButton', { number: h.rollback.number })}
          </Button>
        )}
      </div>
      <NodeList nodes={h.failingNodes} />
      <CalcExplainer h={h} wh={wh} />
    </div>
  );
}

// ───────────────────────── Warnungen ─────────────────────────

const dismissTip = () => t('health.alert.dismissTip');

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
              {t('health.alert.title', { number: alert.versionNumber })}{' '}
              <InfoTip label={t('health.alert.whyLabel')}>
                <p>
                  {t('health.alert.why1')}
                  {settings && ` ${t('health.alert.whyDetail', { runs: runs(settings.minRuns), threshold: settings.thresholdPct })}`}
                </p>
                <p>{t('health.alert.why2')}</p>
                <p><Link to={SETTINGS_LINK} className="underline underline-offset-2 hover:text-text">{t('health.explainer.changeThresholds')}</Link></p>
              </InfoTip>
            </div>
            <div className="mt-1 text-sm text-muted">
              {t(node ? 'health.alert.bodyNode' : 'health.alert.body', {
                rate: pct(alert.rate), failed: alert.failed, total: alert.total, baseline: pct(alert.baselineRate), name: node?.name ?? '', when: timeAgo(alert.createdAt),
              })}
            </div>
            <div className="mt-2 text-[13px] text-dim">
              {t(alert.rollbackNumber ? 'health.alert.lookUrgent' : 'health.alert.look', { number: alert.versionNumber, rollback: alert.rollbackNumber ?? '' })}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" icon={<EyeOff className="size-4" />} title={dismissTip()} onClick={async () => {
            await api(`/health/alerts/${alert.id}/dismiss`, { method: 'POST' });
            toast(t('health.alert.dismissedVersion', { number: alert.versionNumber }));
            onDismissed();
          }}>{t('health.alert.dismiss')}</Button>
          <Button size="sm" onClick={onShow}>{t('health.alert.viewChange')}</Button>
          {alert.rollbackVersionId && (
            <Button size="sm" variant="primary" icon={<RotateCcw className="size-4" />} onClick={() => onRollback(alert.rollbackVersionId!, alert.rollbackNumber!)}>
              {t('health.panel.rollbackButton', { number: alert.rollbackNumber! })}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Übersicht: alle offenen Warnungen. Ohne Auswertung oder ohne Warnungen unsichtbar. */
export function AlertsCard(controls: WidgetControls) {
  const alerts = useApi<HealthAlert[]>('/health/alerts', { poll: () => 60_000 });
  const [rollback, setRollback] = useState<{ alert: HealthAlert } | null>(null);
  const toast = useToast();
  const list = alerts.data ?? [];
  if (!list.length) return null;

  return (
    <Card className="border-del/30">
      <WidgetHeader id="health" {...controls} className="border-b border-line px-4 py-3" aside={
        <Link to={SETTINGS_LINK} className="mr-2 text-xs text-dim transition-colors hover:text-text">{t('health.alert.howDetected')}</Link>
      }>
        <p className="mt-1 flex items-center gap-2 text-[13px] text-muted">
          <AlertTriangle className="size-4 shrink-0 text-del" />
          {t('health.alert.cardTitle', { count: list.length })}
        </p>
        <p className="mt-1 text-[13px] text-muted">{t('health.alert.cardText')}</p>
      </WidgetHeader>
      <div className="divide-y divide-line">
        {list.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <Link to={`/workflows/${a.workflowId}?v=${a.versionId}`} className="min-w-0 flex-1 hover:text-text">
              <div className="truncate text-sm font-medium">{a.workflowName}</div>
              <div className="mt-0.5 truncate text-[13px] text-muted">
                {rich('health.alert.row', { r: (c) => <span className="text-del">{c}</span> }, { instance: a.instanceName, number: a.versionNumber, rate: pct(a.rate), baseline: pct(a.baselineRate) })}
                {a.failingNodes[0] && t('health.alert.rowNode', { name: a.failingNodes[0].name })}
              </div>
            </Link>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" title={dismissTip()} onClick={async () => {
                await api(`/health/alerts/${a.id}/dismiss`, { method: 'POST' });
                toast(t('health.alert.dismissed'));
                alerts.reload();
              }}>{t('health.alert.dismiss')}</Button>
              {a.rollbackVersionId && (
                <Button size="sm" icon={<RotateCcw className="size-4" />} title={t('health.alert.rollbackTitle', { number: a.rollbackNumber! })} onClick={() => setRollback({ alert: a })}>
                  {t('health.panel.rollbackButton', { number: a.rollbackNumber! })}
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
