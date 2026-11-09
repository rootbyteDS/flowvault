import { useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { CircleCheck, CircleX } from 'lucide-react';
import { api, useApi, type AiSettings, type HealthSettings, type HealthStatus } from '../api.ts';
import { Button, Card, ErrorBox, Field, InfoTip, PageHeader, Status, Switch, inputCls, useToast } from '../components/ui.tsx';
import { AdminSettings } from '../components/AdminSettings.tsx';
import { SystemSettings } from '../components/SystemSettings.tsx';
import { HowItWorks, explainPollError } from '../components/health.tsx';
import { LanguageSelect } from '../components/LanguageSelect.tsx';
import { LOCALES } from '../../../shared/i18n/index.ts';
import { paragraphs, rich, t } from '../i18n.tsx';
import { cx, formatNumber, timeAgo } from '../util.ts';

function NumberField({ label, hint, info, value, onChange, min, max }: { label: string; hint: string; info?: ReactNode; value: number; onChange: (v: number) => void; min: number; max: number }) {
  return (
    <Field label={label} hint={hint} info={info}>
      <input className={cx(inputCls, 'font-mono')} type="number" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </Field>
  );
}

/** Einstellungen für die Fehlerquote pro Version. Erst erklären, dann Zustand, dann Stellschrauben. */
function HealthCard() {
  const toast = useToast();
  const st = useApi<HealthStatus>('/health/status', { poll: (d) => (d.settings.enabled && d.instances.some((i) => !i.lastPollAt) ? 5_000 : false) });
  const [form, setForm] = useState<HealthSettings>();
  const [busy, setBusy] = useState<'save' | 'poll'>();
  const location = useLocation();

  useEffect(() => {
    if (st.data && !form) setForm(st.data.settings);
  }, [st.data, form]);

  // Links wie „Wie wird das erkannt?“ springen direkt hierher
  useEffect(() => {
    if (location.hash === '#fehlerquote') document.getElementById('fehlerquote')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [location.hash, !!st.data]);

  async function save() {
    setBusy('save');
    try {
      const s = await api<HealthSettings>('/health/settings', { method: 'PUT', body: form });
      setForm(s);
      toast(t('settings.health.saved'));
      st.reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(undefined);
    }
  }

  async function poll() {
    setBusy('poll');
    try {
      await api('/health/poll', { method: 'POST' });
      toast(t('settings.health.polled'));
      st.reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(undefined);
    }
  }

  const set = <K extends keyof HealthSettings>(k: K, v: HealthSettings[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const saved = st.data?.settings;
  const dirty = !!form && !!saved && (Object.keys(form) as (keyof HealthSettings)[]).some((k) => form[k] !== saved[k]);
  const shown = form ?? saved;
  const example = shown ? Math.min(5, 100 - shown.thresholdPct) : 5;

  return (
    <Card id="fehlerquote" className="scroll-mt-6 p-6 md:col-span-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-medium">
          {t('settings.health.title')}
          <InfoTip label={t('settings.health.title')}>{paragraphs('settings.health.titleTip')}</InfoTip>
        </h2>
        {st.error && !st.data ? (
          <Status tone="del">{t('settings.health.noResponse')}</Status>
        ) : saved ? (
          <Status tone={saved.enabled ? 'add' : 'neutral'}>{t(saved.enabled ? 'settings.health.on' : 'settings.health.off')}</Status>
        ) : null}
      </div>
      <p className="mt-2 max-w-3xl text-sm text-muted">{t('settings.health.intro')}</p>

      {st.error && !st.data && (
        <div className="mt-4">
          <ErrorBox>{t('settings.health.unavailable')}</ErrorBox>
        </div>
      )}

      {shown && (
        <div className="mt-5">
          <HowItWorks s={shown} />
        </div>
      )}

      {st.data && (
        <div className="mt-6">
          <h3 className="flex items-center gap-1.5 text-[13px] text-muted">
            {t('settings.health.perInstance')}
            <InfoTip label={t('settings.health.perInstance')}>{paragraphs('settings.health.perInstanceTip')}</InfoTip>
          </h3>
          {st.data.instances.length === 0 ? (
            <p className="mt-2 text-sm text-dim">
              {t(st.data.settings.enabled ? 'settings.health.nothingPolled' : 'settings.health.pollingOff')}
            </p>
          ) : (
            <div className="mt-2 divide-y divide-line rounded-lg bg-panel-3 text-sm">
              {st.data.instances.map((i) => {
                const err = i.error ? explainPollError(i.error) : null;
                return (
                  <div key={i.instanceId} className="px-4 py-2.5">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span className={cx('size-1.5 rounded-full', i.ok === null ? 'bg-dim' : i.ok ? 'bg-add' : 'bg-del')} />
                      <span className="font-medium">{i.name}</span>
                      {i.lastPollAt ? (
                        <span className="text-xs text-dim">
                          {rich('settings.health.stored', { n: (c) => <span className="font-mono">{c}</span> }, { count: i.executions, formatted: formatNumber(i.executions), when: timeAgo(i.lastPollAt) })}
                        </span>
                      ) : (
                        <span className="text-xs text-dim">{t('settings.health.firstPoll')}</span>
                      )}
                    </div>
                    {err && (
                      <div className="mt-1 pl-[22px] text-xs leading-5">
                        <span className="text-del">{err.title}</span>
                        {err.fix && <span className="text-dim">. {err.fix}</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {form && (
        <>
          <div className="mt-8 grid gap-8 lg:grid-cols-2">
            <section>
              <h3 className="text-sm font-medium">{t('settings.health.whenToWarn')}</h3>
              <p className="mt-1 text-[13px] leading-5 text-muted">
                {t('settings.health.example', { example, threshold: example + form.thresholdPct, count: form.minRuns })}
              </p>
              <div className="mt-4 space-y-4">
                <Switch checked={form.alerts} onChange={(v) => set('alerts', v)} label={t('settings.health.alerts')} hint={t('settings.health.alertsHint')} info={paragraphs('settings.health.alertsTip')} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <NumberField label={t('settings.health.threshold')} hint={t('settings.health.thresholdHint')} info={paragraphs('settings.health.thresholdTip')} value={form.thresholdPct} min={1} max={100} onChange={(v) => set('thresholdPct', v)} />
                  <NumberField label={t('settings.health.minRuns')} hint={t('settings.health.minRunsHint')} info={paragraphs('settings.health.minRunsTip')} value={form.minRuns} min={1} max={1000} onChange={(v) => set('minRuns', v)} />
                </div>
                <Switch checked={form.includeManual} onChange={(v) => set('includeManual', v)} label={t('settings.health.manual')} hint={t('settings.health.manualHint')} info={paragraphs('settings.health.manualTip')} />
              </div>
            </section>
            <section>
              <h3 className="text-sm font-medium">{t('settings.health.storage')}</h3>
              <p className="mt-1 text-[13px] leading-5 text-muted">{rich('settings.health.storageText', { code: (c) => <code className="font-mono text-text">{c}</code> })}</p>
              <div className="mt-4 space-y-4">
                <Switch checked={form.enabled} onChange={(v) => set('enabled', v)} label={t('settings.health.enabled')} hint={t('settings.health.enabledHint')} info={paragraphs('settings.health.enabledTip')} />
                <div className="grid gap-4 sm:grid-cols-3">
                  <NumberField label={t('settings.health.pollMinutes')} hint={t('settings.health.pollMinutesHint')} info={paragraphs('settings.health.pollMinutesTip')} value={form.pollMinutes} min={1} max={1440} onChange={(v) => set('pollMinutes', v)} />
                  <NumberField label={t('settings.health.lookback')} hint={t('settings.health.lookbackHint')} info={paragraphs('settings.health.lookbackTip')} value={form.lookbackDays} min={1} max={90} onChange={(v) => set('lookbackDays', v)} />
                  <NumberField label={t('settings.health.retention')} hint={t('settings.health.retentionHint')} info={paragraphs('settings.health.retentionTip')} value={form.retentionDays} min={1} max={365} onChange={(v) => set('retentionDays', v)} />
                </div>
              </div>
            </section>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <Button variant="primary" loading={busy === 'save'} disabled={!dirty} onClick={save}>{t('common.save')}</Button>
            <Button loading={busy === 'poll'} onClick={poll} title={t('settings.health.pollNowTitle')}>{t('settings.health.pollNow')}</Button>
            {dirty && (
              <button className="text-[13px] text-dim transition-colors hover:text-text" onClick={() => setForm(saved)}>
                {t('settings.health.discard')}
              </button>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

function AiCard() {
  const toast = useToast();
  const st = useApi<AiSettings>('/ai/settings', { poll: (d) => (d.pending > 0 ? 3000 : false) });
  const [form, setForm] = useState({ enabled: false, auto: true, model: '', base_url: '', api_key: '', language: '' });
  const [models, setModels] = useState<string[]>([]);
  const [test, setTest] = useState<{ ok: boolean; text: string }>();
  const [busy, setBusy] = useState<'save' | 'test' | 'backfill'>();
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => {
    if (st.data) setForm((f) => ({ ...f, enabled: st.data!.enabled, auto: st.data!.auto, model: st.data!.model, base_url: st.data!.base_url, language: st.data!.language }));
    // nur beim ersten Laden übernehmen
  }, [!!st.data]);

  async function runTest() {
    setBusy('test');
    try {
      const r = await api<{ ok: boolean; models?: string[]; error?: string }>('/ai/models', { body: { base_url: form.base_url, api_key: form.api_key } });
      if (r.ok) {
        setModels(r.models!);
        setTest({ ok: true, text: t('settings.ai.connected', { count: r.models!.length }) });
      } else setTest({ ok: false, text: r.error! });
    } finally {
      setBusy(undefined);
    }
  }

  async function save() {
    setBusy('save');
    try {
      const d = await api<AiSettings>('/ai/settings', { method: 'PUT', body: form });
      st.setData(d);
      setForm((f) => ({ ...f, api_key: '' }));
      toast(t('settings.ai.saved'));
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(undefined);
    }
  }

  async function backfill() {
    setBusy('backfill');
    try {
      const r = await api<{ count: number }>('/ai/backfill', { method: 'POST' });
      toast(t('settings.ai.queued', { count: r.count }));
      st.reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(undefined);
    }
  }

  const s = st.data;
  return (
    <Card className="p-6 md:col-span-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-medium">{t('settings.ai.title')}</h2>
        {s && (
          <span className="flex items-center gap-2 text-[13px] text-muted">
            <span className={cx('size-1.5 rounded-full', s.enabled && s.configured ? 'bg-add' : 'bg-dim')} />
            {s.enabled && s.configured ? rich('settings.ai.active', { m: (c) => <span className="font-mono text-xs">{c}</span> }, { model: s.model }) : t('settings.ai.off')}
          </span>
        )}
      </div>
      <p className="mt-2 max-w-3xl text-sm text-muted">{t('settings.ai.intro')}</p>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Field
          label={t('settings.ai.apiKey')}
          hint={s?.configured ? t('settings.ai.keyKept', { hint: s.key_hint ?? '' }) : rich('settings.ai.keyHint', { a: (c) => <a className="text-muted underline decoration-line-2 underline-offset-2 hover:text-text" href="https://melious.ai" target="_blank" rel="noreferrer">{c}</a> })}
        >
          <input className={cx(inputCls, 'font-mono')} type="password" autoComplete="off" value={form.api_key} onChange={(e) => { setForm({ ...form, api_key: e.target.value }); setTest(undefined); }} placeholder={s?.configured ? '••••••••' : ''} />
        </Field>
        <Field label={t('settings.ai.model')} hint={models.length ? t('settings.ai.modelsLoaded', { count: models.length }) : t('settings.ai.modelsLoadHint')}>
          <input className={cx(inputCls, 'font-mono')} list="ai-models" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
          <datalist id="ai-models">{models.map((m) => <option key={m} value={m} />)}</datalist>
        </Field>
        {advanced && (
          <Field label={t('settings.ai.baseUrl')} hint={t('settings.ai.baseUrlHint')}>
            <input className={cx(inputCls, 'font-mono')} value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} />
          </Field>
        )}
        <Field label={t('settings.ai.language')} hint={t('settings.ai.languageHint')}>
          <select className={inputCls} value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })}>
            {LOCALES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
          </select>
        </Field>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Switch checked={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} label={t('settings.ai.use')} hint={t('settings.ai.useHint')} />
        <Switch checked={form.auto} onChange={(v) => setForm({ ...form, auto: v })} label={t('settings.ai.auto')} hint={t('settings.ai.autoHint')} />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <Button variant="primary" loading={busy === 'save'} onClick={save}>{t('common.save')}</Button>
        <Button loading={busy === 'test'} onClick={runTest} disabled={!form.api_key && !s?.configured}>{t('settings.ai.test')}</Button>
        {!advanced && <button className="text-[13px] text-dim transition-colors hover:text-text" onClick={() => setAdvanced(true)}>{t('settings.ai.changeUrl')}</button>}
        {test && (
          <span className={cx('flex items-center gap-2 text-[13px]', test.ok ? 'text-add' : 'text-del')}>
            {test.ok ? <CircleCheck className="size-4" /> : <CircleX className="size-4" />}
            {test.text}
          </span>
        )}
      </div>

      {s?.configured && (s.missing > 0 || s.pending > 0) && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-panel-3 px-4 py-3 text-sm">
          <span className="text-muted">
            {rich(s.pending > 0 ? 'settings.ai.pending' : 'settings.ai.missing', { n: (c) => <span className="font-mono text-text">{c}</span> }, { count: s.pending > 0 ? s.pending : s.missing })}
          </span>
          {s.pending === 0 && <Button size="sm" loading={busy === 'backfill'} onClick={backfill} disabled={!s.enabled}>{t('settings.ai.backfill')}</Button>}
        </div>
      )}
    </Card>
  );
}

export function SettingsPage() {
  const code = (c: string) => <code className="font-mono text-text">{c}</code>;
  return (
    <>
      <PageHeader title={t('settings.title')} />
      <div className="grid max-w-5xl gap-6 md:grid-cols-2">
        <SystemSettings />
        <Card className="p-6 md:col-span-2">
          <h2 className="text-base font-medium">{t('settings.language.title')}</h2>
          <p className="mt-2 max-w-3xl text-sm text-muted">{t('settings.language.text')}</p>
          <LanguageSelect className="mt-4 flex w-56" />
        </Card>
        <HealthCard />
        <AiCard />
        <AdminSettings />
        <Card className="p-6">
          <h2 className="text-base font-medium">{t('settings.how.title')}</h2>
          <ul className="mt-4 list-disc space-y-2 pl-4 text-sm text-muted marker:text-dim">
            <li>{t('settings.how.pull')}</li>
            <li>{t('settings.how.versions')}</li>
            <li>{t('settings.how.deleted')}</li>
            <li>{rich('settings.how.keys', { code })}</li>
            <li>{rich('settings.how.health', { code })}</li>
            <li>{t('settings.how.ai')}</li>
            <li>{rich('settings.how.data', { code })}</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
