import { useEffect, useState } from 'react';
import { CircleCheck, CircleX, PlugZap } from 'lucide-react';
import { api, type Instance } from '../api.ts';
import { Button, ErrorBox, Field, Modal, inputCls, useToast } from './ui.tsx';
import { cx } from '../util.ts';

const COLORS = ['#ff6d5a', '#ea4b71', '#a78bfa', '#58a6ff', '#2dd4bf', '#3fb950', '#e3a92b', '#94a3b8'];
const INTERVALS = [
  [0, 'Nur manuell'],
  [5, 'Alle 5 Minuten'],
  [15, 'Alle 15 Minuten'],
  [30, 'Alle 30 Minuten'],
  [60, 'Stündlich'],
  [360, 'Alle 6 Stunden'],
  [1440, 'Täglich'],
] as const;

export function InstanceForm({ open, onClose, instance, onSaved }: {
  open: boolean;
  onClose: () => void;
  instance?: Instance;
  onSaved: (i: Instance) => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', base_url: '', api_key: '', sync_interval: 15, color: COLORS[0] });
  const [test, setTest] = useState<{ ok: boolean; text: string }>();
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) return;
    setForm(
      instance
        ? { name: instance.name, base_url: instance.base_url, api_key: '', sync_interval: instance.sync_interval, color: instance.color }
        : { name: '', base_url: '', api_key: '', sync_interval: 15, color: COLORS[Math.floor(Math.random() * COLORS.length)] },
    );
    setTest(undefined);
    setError(undefined);
  }, [open, instance]);

  // Der gespeicherte Key geht nur an die gespeicherte Adresse (der Server prüft das ebenfalls)
  const urlChanged = !!instance && form.base_url.trim().replace(/\/+$/, '') !== instance.base_url;

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (k === 'base_url' || k === 'api_key') setTest(undefined);
  };

  async function runTest() {
    setTesting(true);
    try {
      const r = await api<{ ok: boolean; error?: string; workflows?: number }>('/instances/test', {
        body: { base_url: form.base_url, api_key: form.api_key, id: instance?.id },
      });
      setTest(r.ok ? { ok: true, text: `Verbunden, ${r.workflows! >= 250 ? '250+' : r.workflows} Workflows gefunden` } : { ok: false, text: r.error! });
      return r.ok;
    } catch (e) {
      setTest({ ok: false, text: (e as Error).message });
      return false;
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    setError(undefined);
    if (!form.name.trim()) return setError('Bitte einen Namen vergeben');
    if (!instance && !form.api_key.trim()) return setError('Bitte einen API-Key eintragen');
    if (instance && urlChanged && !form.api_key.trim()) return setError('Bei geänderter URL bitte den API-Key erneut eingeben');
    setSaving(true);
    try {
      if (!test?.ok && (!instance || form.api_key || form.base_url !== instance.base_url)) {
        const ok = await runTest();
        if (!ok) {
          setSaving(false);
          return;
        }
      }
      const saved = instance
        ? await api<Instance>(`/instances/${instance.id}`, { method: 'PUT', body: form })
        : await api<Instance>('/instances', { body: form });
      toast(instance ? 'Instanz gespeichert' : `„${saved.name}“ verbunden – erste Sicherung läuft …`);
      onSaved(saved);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={instance ? 'Instanz bearbeiten' : 'n8n-Instanz verbinden'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={save} loading={saving}>
            {instance ? 'Speichern' : 'Verbinden'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <input className={inputCls} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="z. B. Produktion" autoFocus />
        </Field>
        <Field label="URL der n8n-Instanz">
          <input className={inputCls} value={form.base_url} onChange={(e) => set('base_url', e.target.value)} placeholder="https://n8n.meinefirma.de" />
        </Field>
        <Field
          label="API-Key"
          hint={
            instance ? (
              urlChanged ? (
                <>Die URL wurde geändert – aus Sicherheitsgründen bitte den API-Key erneut eingeben.</>
              ) : (
                <>Leer lassen, um den gespeicherten Key ({instance.key_hint}) zu behalten.</>
              )
            ) : (
              <>In n8n unter <span className="text-muted">Settings → n8n API → Create an API key</span> erstellen. Der Key wird verschlüsselt gespeichert.</>
            )
          }
        >
          <input
            className={cx(inputCls, 'font-mono')}
            type="password"
            autoComplete="off"
            value={form.api_key}
            onChange={(e) => set('api_key', e.target.value)}
            placeholder={instance ? '••••••••' : 'eyJhbGciOi…'}
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Automatische Sicherung">
            <select className={inputCls} value={form.sync_interval} onChange={(e) => set('sync_interval', Number(e.target.value))}>
              {INTERVALS.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </Field>
          <Field label="Farbe">
            <div className="flex h-9 items-center gap-1.5">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => set('color', c)}
                  className={cx('size-5 rounded-md transition-colors', form.color === c ? 'ring-2 ring-text ring-offset-2 ring-offset-panel' : 'opacity-60 hover:opacity-100')}
                  style={{ background: c }}
                />
              ))}
            </div>
          </Field>
        </div>

        <div className="flex items-center gap-3 rounded-lg border border-line px-3 py-3">
          <Button size="sm" onClick={runTest} loading={testing} icon={<PlugZap className="size-4" />} disabled={!form.base_url}>
            Verbindung testen
          </Button>
          {test && (
            <span className={cx('flex min-w-0 items-center gap-1.5 text-[13px]', test.ok ? 'text-add' : 'text-del')}>
              {test.ok ? <CircleCheck className="size-4 shrink-0" /> : <CircleX className="size-4 shrink-0" />}
              <span className="truncate" title={test.text}>{test.text}</span>
            </span>
          )}
        </div>
        {error && <ErrorBox>{error}</ErrorBox>}
      </div>
    </Modal>
  );
}
