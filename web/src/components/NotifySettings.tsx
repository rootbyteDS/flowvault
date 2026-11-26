import { useState } from 'react';
import { Bell, Copy, KeyRound, QrCode, RotateCcw, Send, Smartphone } from 'lucide-react';
import { api, useApi, type Instance } from '../api.ts';
import type { NotifyDevice, NotifyPairingCreated, NotifyState, RedactionMode } from '../../../shared/notify.ts';
import { Button, Card, ErrorBox, Field, InfoTip, Modal, Status, Switch, inputCls, useToast } from './ui.tsx';
import { paragraphs, t } from '../i18n.tsx';
import { cx, timeAgo } from '../util.ts';

function CopyButton({ value }: { value: string }) {
  const toast = useToast();
  return (
    <Button
      size="sm"
      icon={<Copy className="size-3.5" />}
      onClick={() => navigator.clipboard.writeText(value).then(() => toast(t('settings.notify.copied')), () => undefined)}
    >
      {t('settings.notify.copy')}
    </Button>
  );
}

/** Mobile App & Benachrichtigungen: Ein/Aus, QR-Pairing, Rollback-Berechtigung pro Gerät, Test-Nachricht und Widerruf. */
export function NotifySettings() {
  const toast = useToast();
  const st = useApi<NotifyState>('/notify');
  const instances = useApi<Instance[]>('/instances');
  const [label, setLabel] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [redaction, setRedaction] = useState<RedactionMode>('lockscreen');
  const [allowRollback, setAllowRollback] = useState(false);
  const [serverUrl, setServerUrl] = useState('');
  const [busy, setBusy] = useState<'toggle' | 'pair' | `test:${number}` | `revoke:${number}` | `rb:${number}`>();
  const [pairing, setPairing] = useState<NotifyPairingCreated>();
  const instanceName = new Map((instances.data ?? []).map((i) => [i.id, i.name]));

  async function toggle(enabled: boolean) {
    setBusy('toggle');
    try {
      st.setData(await api<NotifyState>('/notify', { method: 'PUT', body: { enabled } }));
      toast(t(enabled ? 'settings.notify.enabled' : 'settings.notify.disabled'));
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(undefined);
    }
  }

  async function startPairing(e: React.FormEvent) {
    e.preventDefault();
    setBusy('pair');
    try {
      const r = await api<NotifyPairingCreated>('/notify/pair', {
        body: {
          label,
          instances: selected.length ? selected : null,
          redactionMode: redaction,
          allowRollback,
          serverUrl: serverUrl.trim() || undefined,
        },
      });
      setPairing(r);
      setLabel('');
      setSelected([]);
      setAllowRollback(false);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(undefined);
    }
  }

  async function toggleDeviceRollback(device: NotifyDevice, next: boolean) {
    setBusy(`rb:${device.id}`);
    try {
      await api(`/notify/devices/${device.id}`, { method: 'PATCH', body: { allowRollback: next } });
      toast(t(next ? 'settings.notify.rollbackEnabled' : 'settings.notify.rollbackDisabled', { name: device.name }));
      st.reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(undefined);
    }
  }

  async function sendTest(device: NotifyDevice) {
    setBusy(`test:${device.id}`);
    try {
      await api(`/notify/devices/${device.id}/test`, { method: 'POST' });
      toast(t('settings.notify.testSent', { name: device.name }));
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(undefined);
    }
  }

  async function revoke(device: NotifyDevice) {
    if (!window.confirm(t('settings.notify.revokeConfirm', { name: device.name }))) return;
    setBusy(`revoke:${device.id}`);
    try {
      await api(`/notify/devices/${device.id}`, { method: 'DELETE' });
      toast(t('settings.notify.revoked'));
      st.reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(undefined);
    }
  }

  const s = st.data;
  const scopeLabel = (ids: number[] | null) =>
    ids === null
      ? t('settings.notify.allInstances')
      : ids.map((id) => instanceName.get(id)).filter(Boolean).join(', ') || t('settings.notify.someInstances', { count: ids.length });

  const pushLabel = (d: NotifyDevice) =>
    d.pushType === 'unifiedpush'
      ? t('settings.notify.pushUnified')
      : d.pushType === 'sse_bg'
        ? t('settings.notify.pushSse')
        : t('settings.notify.pushPoll');

  return (
    <Card id="mobile-app" className="scroll-mt-6 p-6 md:col-span-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-medium">
          <Bell className="size-4 text-accent-hi" />
          {t('settings.notify.title')}
          <InfoTip label={t('settings.notify.title')}>{paragraphs('settings.notify.titleTip')}</InfoTip>
        </h2>
        {s && <Status tone={s.enabled ? 'add' : 'neutral'}>{t(s.enabled ? 'settings.notify.on' : 'settings.notify.off')}</Status>}
      </div>
      <p className="mt-2 max-w-3xl text-sm text-muted">{t('settings.notify.intro')}</p>

      {st.error && !s && (
        <div className="mt-4">
          <ErrorBox>{t('settings.notify.unavailable')}</ErrorBox>
        </div>
      )}

      {s && (
        <>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <Switch
              checked={s.enabled}
              onChange={(v) => busy !== 'toggle' && toggle(v)}
              label={t('settings.notify.enable')}
              hint={t('settings.notify.enableHint')}
            />
            <Field label={t('settings.notify.endpoint')} hint={t('settings.notify.endpointHint')}>
              <div className="flex items-center gap-2">
                <code className={cx(inputCls, 'flex items-center truncate font-mono')}>{window.location.origin}</code>
                <CopyButton value={window.location.origin} />
              </div>
            </Field>
          </div>

          <div className="mt-6">
            <h3 className="flex items-center gap-1.5 text-[13px] text-muted">
              <Smartphone className="size-3.5" />
              {t('settings.notify.devices')}
            </h3>
            {s.devices.length === 0 ? (
              <p className="mt-2 text-sm text-dim">{t('settings.notify.noDevices')}</p>
            ) : (
              <div className="mt-2 divide-y divide-line rounded-lg bg-panel-3 text-sm">
                {s.devices.map((dev) => (
                  <div key={dev.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-medium">{dev.name}</span>
                        <span className="font-mono text-xs text-dim">{dev.hint}</span>
                        <span className="rounded bg-panel-2 px-1.5 py-0.5 text-[11px] text-muted">{pushLabel(dev)}</span>
                        {dev.encryptionKeyConfigured && (
                          <span className="inline-flex items-center gap-1 rounded bg-add/15 px-1.5 py-0.5 text-[11px] text-add">
                            <KeyRound className="size-3" />
                            {t('settings.notify.e2eActive')}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs text-dim">
                        {scopeLabel(dev.instances)} · {t(`settings.notify.redaction.${dev.redactionMode}`)} ·{' '}
                        {dev.lastSeenAt ? t('settings.notify.lastSeen', { when: timeAgo(dev.lastSeenAt) }) : t('settings.notify.neverSeen')}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        icon={<RotateCcw className="size-3.5" />}
                        loading={busy === `rb:${dev.id}`}
                        onClick={() => toggleDeviceRollback(dev, !dev.allowRollback)}
                        title={t('settings.notify.rollbackToggleHint')}
                      >
                        {t(dev.allowRollback ? 'settings.notify.rollbackAllowed' : 'settings.notify.rollbackAllow')}
                      </Button>
                      <Button
                        size="sm"
                        icon={<Send className="size-3.5" />}
                        loading={busy === `test:${dev.id}`}
                        disabled={!s.enabled}
                        onClick={() => sendTest(dev)}
                      >
                        {t('settings.notify.test')}
                      </Button>
                      <Button size="sm" variant="danger" loading={busy === `revoke:${dev.id}`} onClick={() => revoke(dev)}>
                        {t('settings.notify.revoke')}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <form onSubmit={startPairing} className="mt-6 border-t border-line pt-4">
            <h3 className="text-[13px] text-muted">{t('settings.notify.newDevice')}</h3>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <Field label={t('settings.notify.name')}>
                <input
                  required
                  maxLength={60}
                  className={inputCls}
                  value={label}
                  placeholder={t('settings.notify.namePlaceholder')}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </Field>
              <Field label={t('settings.notify.redactionLabel')} hint={t('settings.notify.redactionHint')}>
                <select className={inputCls} value={redaction} onChange={(e) => setRedaction(e.target.value as RedactionMode)}>
                  <option value="lockscreen">{t('settings.notify.redaction.lockscreen')}</option>
                  <option value="full">{t('settings.notify.redaction.full')}</option>
                  <option value="none">{t('settings.notify.redaction.none')}</option>
                </select>
              </Field>
              <Field label={t('settings.notify.instances')} hint={t('settings.notify.instancesHint')}>
                <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1.5">
                  {(instances.data ?? []).map((i) => (
                    <label key={i.id} className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="accent-accent-strong"
                        checked={selected.includes(i.id)}
                        onChange={(e) => setSelected((cur) => (e.target.checked ? [...cur, i.id] : cur.filter((x) => x !== i.id)))}
                      />
                      {i.name}
                    </label>
                  ))}
                </div>
              </Field>
              <Field label={t('settings.notify.serverUrl')} hint={t('settings.notify.serverUrlHint')}>
                <input
                  className={cx(inputCls, 'font-mono')}
                  value={serverUrl}
                  placeholder={window.location.origin}
                  onChange={(e) => setServerUrl(e.target.value)}
                />
              </Field>
            </div>
            <div className="mt-4">
              <Switch
                checked={allowRollback}
                onChange={setAllowRollback}
                label={t('settings.notify.rollbackAllowLabel')}
                hint={t('settings.notify.rollbackAllowHint')}
              />
            </div>
            <div className="mt-4">
              <Button type="submit" variant="primary" icon={<QrCode className="size-4" />} loading={busy === 'pair'} disabled={!s.enabled}>
                {t('settings.notify.pairButton')}
              </Button>
            </div>
          </form>
        </>
      )}

      <Modal
        open={!!pairing}
        onClose={() => {
          setPairing(undefined);
          st.reload();
        }}
        title={pairing ? t('settings.notify.pairTitle', { name: pairing.label }) : ''}
        width="max-w-lg"
        footer={
          <Button
            variant="primary"
            onClick={() => {
              setPairing(undefined);
              st.reload();
            }}
          >
            {t('settings.notify.done')}
          </Button>
        }
      >
        {pairing && (
          <div className="space-y-4">
            <p className="text-sm text-muted">{t('settings.notify.pairHint')}</p>
            <div className="flex justify-center rounded-xl bg-white p-4">
              <img src={pairing.qrDataUrl} alt="FlowVault Pairing QR-Code" className="size-56" />
            </div>
            <div>
              <span className="text-[13px] text-muted">{t('settings.notify.manualCode')}</span>
              <div className="mt-1.5 flex items-center gap-2">
                <code className={cx(inputCls, 'flex items-center overflow-x-auto font-mono text-xs whitespace-nowrap')}>{pairing.code}</code>
                <CopyButton value={pairing.code} />
              </div>
              <p className="mt-1.5 text-xs text-mod">{t('settings.notify.expiresHint')}</p>
            </div>
          </div>
        )}
      </Modal>
    </Card>
  );
}
