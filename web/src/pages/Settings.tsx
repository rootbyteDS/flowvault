import { useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { CircleCheck, CircleX } from 'lucide-react';
import { api, useApi, type AiSettings, type HealthSettings, type HealthStatus } from '../api.ts';
import { Button, Card, ErrorBox, Field, InfoTip, PageHeader, Status, Switch, inputCls, useToast } from '../components/ui.tsx';
import { HowItWorks, explainPollError } from '../components/health.tsx';
import { cx, timeAgo } from '../util.ts';

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
      toast('Gespeichert. Gilt ab der nächsten Auswertung.');
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
      toast('Ausführungen abgerufen und ausgewertet');
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
          Fehlerquote pro Version
          <InfoTip label="Fehlerquote pro Version">
            <p>Für jede gesicherte Version zählt FlowVault, wie viele Ausführungen in n8n danach gescheitert sind.</p>
            <p>So siehst du direkt in der Versionshistorie, <b>welche Änderung etwas kaputt gemacht hat</b>, an welchem Node es scheitert und auf welche Version du zurück kannst.</p>
          </InfoTip>
        </h2>
        {st.error && !st.data ? (
          <Status tone="del">Antwortet nicht</Status>
        ) : saved ? (
          <Status tone={saved.enabled ? 'add' : 'neutral'}>{saved.enabled ? 'Aktiv' : 'Aus'}</Status>
        ) : null}
      </div>
      <p className="mt-2 max-w-3xl text-sm text-muted">
        Zeigt bei jeder Version, wie oft der Workflow danach in n8n gescheitert ist, und warnt, wenn eine Änderung etwas kaputt gemacht hat.
        Das kann ein Git-Repository nicht: Es kennt nur den Code, nicht den laufenden Betrieb.
      </p>

      {st.error && !st.data && (
        <div className="mt-4">
          <ErrorBox>
            Die Auswertung der Ausführungen antwortet gerade nicht. FlowVault startet sie automatisch neu, versuch es in ein paar Sekunden noch einmal.
            Bleibt es dabei, steht der Grund im Server-Log. Versionen, Vergleich und Wiederherstellen funktionieren weiter.
          </ErrorBox>
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
            Abruf je Instanz
            <InfoTip label="Abruf je Instanz">
              <p>Pro verbundener n8n-Instanz: wann FlowVault zuletzt Ausführungen geholt hat und wie viele gespeichert sind.</p>
              <p><b>Grüner Punkt</b>: letzter Abruf hat geklappt. <b>Roter Punkt</b>: fehlgeschlagen, der Grund steht darunter. Der nächste Abruf versucht es automatisch erneut.</p>
            </InfoTip>
          </h3>
          {st.data.instances.length === 0 ? (
            <p className="mt-2 text-sm text-dim">
              {st.data.settings.enabled ? 'Noch nichts abgerufen. Sobald eine Instanz verbunden ist, startet der erste Abruf von selbst.' : 'Der Abruf ist ausgeschaltet.'}
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
                          <span className="font-mono">{i.executions.toLocaleString('de-DE')}</span> Ausführungen gespeichert · abgerufen {timeAgo(i.lastPollAt)}
                        </span>
                      ) : (
                        <span className="text-xs text-dim">Erster Abruf läuft</span>
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
              <h3 className="text-sm font-medium">Wann warnen?</h3>
              <p className="mt-1 text-[13px] leading-5 text-muted">
                Beispiel mit diesen Werten: Lief ein Workflow vorher mit {example} % Fehlern, warnt FlowVault ab {example + form.thresholdPct} %,
                sobald die neue Version mindestens {form.minRuns} {form.minRuns === 1 ? 'Lauf' : 'Läufe'} hatte.
              </p>
              <div className="mt-4 space-y-4">
                <Switch checked={form.alerts} onChange={(v) => set('alerts', v)} label="Warnen und Rollback vorschlagen" hint="Auf der Übersicht und beim Workflow. Zurückgesetzt wird nie automatisch, nur auf deinen Klick." info={<>
                  <p>Die Warnung erscheint auf der Übersicht und oben auf der Workflow-Seite, zusammen mit der letzten Version, die stabil lief.</p>
                  <p>Sie verschwindet von selbst, wenn du zurücksetzt oder eine neuere Version wieder normal läuft. Blendest du sie aus, kommt sie für dieselbe Version nicht wieder, für eine spätere schon.</p>
                  <p>Aus: Die Fehlerquote wird weiter angezeigt und auffällige Versionen werden rot markiert, nur ohne Warnung.</p>
                </>} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <NumberField label="Anstieg ab (Prozentpunkte)" hint="Kleiner = empfindlicher, mehr Warnungen" info={<>
                    <p><b>Prozentpunkte, nicht Prozent</b>: Von 5 % auf 25 % Fehler sind 20 Prozentpunkte.</p>
                    <p>Verglichen wird die Fehlerquote der neuen Version mit der der Versionen davor. Liegt sie mindestens so viel höher, gilt die Version als auffällig.</p>
                    <p>Gut zum Start: 20. Bei Workflows, die nie scheitern dürfen, eher 5 bis 10.</p>
                  </>} value={form.thresholdPct} min={1} max={100} onChange={(v) => set('thresholdPct', v)} />
                  <NumberField label="Mindestens Läufe" hint="Wenige Läufe sind Zufall. Darunter wird nur angezeigt, nicht bewertet." info={<>
                    <p>Bei 2 Läufen mit einem Fehler wären es schon 50 %. Deshalb bewertet FlowVault eine Version erst ab dieser Zahl abgeschlossener Läufe. Für die Versionen davor gilt dieselbe Grenze.</p>
                    <p>Seltene Workflows, z. B. einmal täglich, brauchen entsprechend Tage, bis sie bewertet werden. Dort lohnt ein kleinerer Wert.</p>
                  </>} value={form.minRuns} min={1} max={1000} onChange={(v) => set('minRuns', v)} />
                </div>
                <Switch checked={form.includeManual} onChange={(v) => set('includeManual', v)} label="Testläufe aus dem Editor mitzählen" hint="Meist aus: Beim Bauen scheitern Testläufe oft mit Absicht." info={<>
                  <p><b>Testläufe</b> startest du im n8n-Editor mit „Execute workflow“ oder „Test step“.</p>
                  <p><b>Produktivläufe</b> kommen von Triggern, Webhooks, Zeitplänen oder anderen Workflows. Nur die sagen etwas darüber, ob der Workflow im Betrieb funktioniert.</p>
                </>} />
              </div>
            </section>
            <section>
              <h3 className="text-sm font-medium">Abruf und Speicher</h3>
              <p className="mt-1 text-[13px] leading-5 text-muted">
                Gespeichert werden nur Status, Zeit und bei Fehlern Node-Name und Meldung, in <code className="font-mono text-text">data/health.db</code>. Ein- und Ausgabedaten nie.
                Der API-Key der Instanz braucht Lesezugriff auf Executions.
              </p>
              <div className="mt-4 space-y-4">
                <Switch checked={form.enabled} onChange={(v) => set('enabled', v)} label="Ausführungen regelmäßig abrufen" hint="Aus: keine neuen Daten, die bisherigen bleiben sichtbar." info={<>
                  <p>Schaltet die ganze Funktion: An fragt FlowVault regelmäßig bei jeder Instanz nach neuen Ausführungen.</p>
                  <p>Aus: Es werden keine neuen geholt und keine neuen Warnungen erzeugt. Schon gespeicherte Ausführungen bleiben, bis du wieder einschaltest.</p>
                </>} />
                <div className="grid gap-4 sm:grid-cols-3">
                  <NumberField label="Alle (Minuten)" hint="Kürzer = Warnung kommt schneller" info={<>
                    <p>Wie oft FlowVault neue Ausführungen holt. Eine Warnung kann frühestens beim nächsten Abruf kommen.</p>
                    <p>Kürzere Abstände erzeugen etwas mehr Anfragen an n8n, sind aber für die meisten Instanzen kein Problem. 5 Minuten passen meistens.</p>
                  </>} value={form.pollMinutes} min={1} max={1440} onChange={(v) => set('pollMinutes', v)} />
                  <NumberField label="Rückblick (Tage)" hint="Beim ersten Abruf. n8n löscht alte Läufe oft selbst." info={<>
                    <p>So weit zurück holt FlowVault Ausführungen, vor allem beim ersten Abruf einer neuen Instanz.</p>
                    <p>Was n8n schon gelöscht hat, ist nicht mehr abrufbar. n8n räumt standardmäßig nach 14 Tagen auf (Executions Pruning).</p>
                  </>} value={form.lookbackDays} min={1} max={90} onChange={(v) => set('lookbackDays', v)} />
                  <NumberField label="Aufbewahren (Tage)" hint="Danach löscht FlowVault sie" info={<>
                    <p>So lange behält FlowVault Ausführungen in seiner eigenen Datenbank, auch wenn n8n sie längst gelöscht hat.</p>
                    <p>Ältere fallen raus, damit verschwindet auch die Fehlerquote sehr alter Versionen. Der Wert ist mindestens so groß wie der Rückblick.</p>
                  </>} value={form.retentionDays} min={1} max={365} onChange={(v) => set('retentionDays', v)} />
                </div>
              </div>
            </section>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <Button variant="primary" loading={busy === 'save'} disabled={!dirty} onClick={save}>Speichern</Button>
            <Button loading={busy === 'poll'} onClick={poll} title="Holt sofort neue Ausführungen aller Instanzen und wertet sie aus">Jetzt abrufen</Button>
            {dirty && (
              <button className="text-[13px] text-dim transition-colors hover:text-text" onClick={() => setForm(saved)}>
                Änderungen verwerfen
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
  const [form, setForm] = useState({ enabled: false, auto: true, model: '', base_url: '', api_key: '' });
  const [models, setModels] = useState<string[]>([]);
  const [test, setTest] = useState<{ ok: boolean; text: string }>();
  const [busy, setBusy] = useState<'save' | 'test' | 'backfill'>();
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => {
    if (st.data) setForm((f) => ({ ...f, enabled: st.data!.enabled, auto: st.data!.auto, model: st.data!.model, base_url: st.data!.base_url }));
    // nur beim ersten Laden übernehmen
  }, [!!st.data]);

  async function runTest() {
    setBusy('test');
    try {
      const r = await api<{ ok: boolean; models?: string[]; error?: string }>('/ai/models', { body: { base_url: form.base_url, api_key: form.api_key } });
      if (r.ok) {
        setModels(r.models!);
        setTest({ ok: true, text: `Verbunden, ${r.models!.length} Modelle verfügbar` });
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
      toast('KI-Einstellungen gespeichert');
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
      toast(`${r.count} Versionen in der Warteschlange`);
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
        <h2 className="text-base font-medium">KI-Änderungstexte mit Melious</h2>
        {s && (
          <span className="flex items-center gap-2 text-[13px] text-muted">
            <span className={cx('size-1.5 rounded-full', s.enabled && s.configured ? 'bg-add' : 'bg-dim')} />
            {s.enabled && s.configured ? <>Aktiv · <span className="font-mono text-xs">{s.model}</span></> : 'Aus'}
          </span>
        )}
      </div>
      <p className="mt-2 max-w-3xl text-sm text-muted">
        Melious schreibt zu jeder neuen Version einen kurzen Änderungstext. Die Modelle laufen auf EU-Infrastruktur, Melious trainiert nicht mit deinen Daten.
        Gesendet werden nur die geänderten Nodes und Parameter. Nur wenn du für eine erste Version selbst einen Text anforderst, geht der ganze Workflow raus.
        Werte von Feldern wie password, token oder apiKey sowie typische Key-Formate (Bearer, JWT, sk_…, ghp_…) entfernt FlowVault vorher. Das ist eine
        Heuristik – fest im Code hinterlegte Zugangsdaten gehören in n8n-Credentials.
      </p>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Field
          label="API-Key"
          hint={s?.configured ? <>Gespeichert ({s.key_hint}). Leer lassen, um ihn zu behalten.</> : <>Unter <a className="text-muted underline decoration-line-2 underline-offset-2 hover:text-text" href="https://melious.ai" target="_blank" rel="noreferrer">melious.ai</a> erstellen. Wird verschlüsselt gespeichert.</>}
        >
          <input className={cx(inputCls, 'font-mono')} type="password" autoComplete="off" value={form.api_key} onChange={(e) => { setForm({ ...form, api_key: e.target.value }); setTest(undefined); }} placeholder={s?.configured ? '••••••••' : ''} />
        </Field>
        <Field label="Modell" hint={models.length ? `${models.length} Modelle geladen` : 'Mit „Verbindung testen“ die verfügbaren Modelle laden'}>
          <input className={cx(inputCls, 'font-mono')} list="ai-models" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
          <datalist id="ai-models">{models.map((m) => <option key={m} value={m} />)}</datalist>
        </Field>
        {advanced && (
          <Field label="API-Adresse" hint="Standard: https://api.melious.ai/v1. Bei einer neuen Adresse muss der API-Key erneut eingegeben werden.">
            <input className={cx(inputCls, 'font-mono')} value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} />
          </Field>
        )}
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Switch checked={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} label="KI-Texte verwenden" hint="Schaltet die Anbindung insgesamt an oder aus" />
        <Switch checked={form.auto} onChange={(v) => setForm({ ...form, auto: v })} label="Automatisch für neue Versionen" hint="Sonst nur auf Knopfdruck in der Versionsansicht" />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <Button variant="primary" loading={busy === 'save'} onClick={save}>Speichern</Button>
        <Button loading={busy === 'test'} onClick={runTest} disabled={!form.api_key && !s?.configured}>Verbindung testen</Button>
        {!advanced && <button className="text-[13px] text-dim transition-colors hover:text-text" onClick={() => setAdvanced(true)}>API-Adresse ändern</button>}
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
            {s.pending > 0 ? <><span className="font-mono text-text">{s.pending}</span> Texte werden gerade erzeugt</> : <><span className="font-mono text-text">{s.missing}</span> bestehende Versionen haben noch keinen KI-Text</>}
          </span>
          {s.pending === 0 && <Button size="sm" loading={busy === 'backfill'} onClick={backfill} disabled={!s.enabled}>Nachholen</Button>}
        </div>
      )}
    </Card>
  );
}

export function SettingsPage() {
  const toast = useToast();
  const status = useApi<{ envPassword: boolean }>('/auth/status');
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function change(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    setBusy(true);
    try {
      await api('/auth/password', { body: { current: cur, next } });
      toast('Passwort geändert');
      setCur('');
      setNext('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Einstellungen" />
      <div className="grid max-w-5xl gap-6 md:grid-cols-2">
        <HealthCard />
        <AiCard />
        <Card className="p-6">
          <h2 className="text-base font-medium">Passwort ändern</h2>
          {status.data?.envPassword ? (
            <p className="mt-3 text-sm text-muted">Das Passwort wird über die Umgebungsvariable <code className="font-mono text-text">ADMIN_PASSWORD</code> gesetzt.</p>
          ) : (
            <form onSubmit={change} className="mt-4 space-y-3">
              <Field label="Aktuelles Passwort"><input type="password" className={inputCls} value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
              <Field label="Neues Passwort"><input type="password" className={inputCls} value={next} onChange={(e) => setNext(e.target.value)} placeholder="Mindestens 8 Zeichen" /></Field>
              {error && <ErrorBox>{error}</ErrorBox>}
              <Button type="submit" variant="primary" loading={busy}>Speichern</Button>
            </form>
          )}
        </Card>
        <Card className="p-6">
          <h2 className="text-base font-medium">So arbeitet FlowVault</h2>
          <ul className="mt-4 list-disc space-y-2 pl-4 text-sm text-muted marker:text-dim">
            <li>Pro Instanz werden alle Workflows über die n8n Public API abgeholt.</li>
            <li>Eine neue Version entsteht nur, wenn sich Inhalt, Name, Status, Tags oder Einstellungen ändern – reine Laufzeitdaten (staticData) werden ignoriert.</li>
            <li>In n8n gelöschte Workflows bleiben mit ihrer kompletten Historie erhalten.</li>
            <li>API-Keys werden mit AES-256-GCM verschlüsselt gespeichert. Den Schlüssel (<code className="font-mono text-text">data/secret.key</code> bzw. <code className="font-mono text-text">APP_SECRET</code>) unbedingt mitsichern.</li>
            <li>Für die Fehlerquote pro Version speichert FlowVault von jeder Ausführung nur Status, Zeit und bei Fehlern Node und Meldung (<code className="font-mono text-text">data/health.db</code>).</li>
            <li>KI-Texte (optional) erzeugt Melious. Ohne API-Key verlässt kein Workflow-Inhalt FlowVault.</li>
            <li>Alle Daten liegen in <code className="font-mono text-text">data/flowvault.db</code> (SQLite).</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
