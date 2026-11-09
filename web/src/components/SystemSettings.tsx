import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import type { AuthStatus } from '../../../shared/auth.ts';
import type { SystemInfo } from '../../../shared/system.ts';
import { api, useApi } from '../api.ts';
import { ProofFields } from './AdminSettings.tsx';
import { Button, Card, ErrorBox, Status } from './ui.tsx';
import { currentLocale, intlLocale, t } from '../i18n.tsx';

/** Die Update-Anleitung steht in der deutschen README und – für alle anderen Sprachen – in der englischen. */
const updateGuideUrl = () =>
  currentLocale() === 'de'
    ? 'https://github.com/rootbyteDS/flowvault#version-und-updates'
    : 'https://github.com/rootbyteDS/flowvault/blob/main/README.en.md#version-and-updates';

export function SystemSettings() {
  const system = useApi<SystemInfo>('/system');
  const auth = useApi<AuthStatus>('/auth/status');
  const location = useLocation();
  const [confirm, setConfirm] = useState(false);
  const [password, setPassword] = useState('');
  const [factor, setFactor] = useState('');
  const [busy, setBusy] = useState(false);
  const [requestedAt, setRequestedAt] = useState<number>();
  const [error, setError] = useState<string>();
  const data = system.data;

  useEffect(() => {
    if (location.hash === '#system') document.getElementById('system')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [location.hash]);

  async function update(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const result = await api<{ status: 'accepted'; requestedAt: number }>('/auth/update', { body: { current: password, factor } });
      setRequestedAt(result.requestedAt);
      setConfirm(false);
      setPassword('');
      setFactor('');
      await auth.reload(); // A recovery code may have been consumed.
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card id="system" className="scroll-mt-6 p-6 md:col-span-2">
      <h2 className="text-base font-medium">{t('system.title')}</h2>
      {system.error && <div className="mt-4"><ErrorBox>{system.error}</ErrorBox><Button className="mt-3" onClick={() => void system.reload()}>{t('system.reload')}</Button></div>}
      {!data && !system.error && <p className="mt-3 text-sm text-muted">{t('system.loading')}</p>}
      {data && (
        <>
          <dl className="mt-4 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
            <div><dt className="text-muted">{t('system.version')}</dt><dd className="mt-1 font-mono">v{data.version}</dd></div>
            <div>
              <dt className="text-muted">{t('system.commit')}</dt>
              <dd className="mt-1 font-mono">
                {data.revision ? <a href={`https://github.com/rootbyteDS/flowvault/commit/${data.revision}`} target="_blank" rel="noopener noreferrer" className="text-accent-hi hover:underline" title={data.revision}>{data.revision.slice(0, 8)}</a> : t('system.noCommit')}
                {data.modified && <span className="ml-2 font-sans text-xs text-muted">{t('system.modified')}</span>}
              </dd>
            </div>
            {data.builtAt && <div><dt className="text-muted">{t('system.builtAt')}</dt><dd className="mt-1">{new Date(data.builtAt).toLocaleString(intlLocale())}</dd></div>}
          </dl>
          <div className="mt-6 border-t border-line pt-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium">{t('system.updates')}</h3>
              <Status tone={data.updates.enabled ? 'add' : 'neutral'}>{t(data.updates.enabled ? 'system.hookConnected' : 'system.manual')}</Status>
            </div>
            <p className="mt-2 text-sm text-muted">
              {t(data.updates.enabled ? 'system.textEnabled' : data.updates.reason === 'invalid_configuration' ? 'system.textInvalid' : 'system.textManual')}
            </p>
            {requestedAt ? (
              <div className="mt-4 space-y-3">
                <p className="text-sm">{t('system.accepted', { time: new Date(requestedAt).toLocaleTimeString(intlLocale()) })}</p>
                <Button onClick={() => window.location.reload()}>{t('system.reloadApp')}</Button>
              </div>
            ) : confirm ? (
              <form onSubmit={update} className="mt-4 max-w-md space-y-4">
                <ProofFields password={password} setPassword={setPassword} factor={factor} setFactor={setFactor} twoFactor={auth.data?.twoFactor} />
                {error && <ErrorBox>{error}</ErrorBox>}
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" variant="primary" loading={busy}>{t('system.requestNow')}</Button>
                  <Button type="button" disabled={busy} onClick={() => { setConfirm(false); setPassword(''); setFactor(''); setError(undefined); }}>{t('common.cancel')}</Button>
                </div>
              </form>
            ) : data.updates.enabled && (
              <Button className="mt-4" variant="primary" disabled={!auth.data?.authenticated} onClick={() => setConfirm(true)}>{t('system.request')}</Button>
            )}
            {auth.error && <div className="mt-3"><ErrorBox>{auth.error}</ErrorBox></div>}
            <div className="mt-4 flex flex-wrap gap-4 text-sm">
              {data.updates.managementUrl && <a href={data.updates.managementUrl} target="_blank" rel="noopener noreferrer" className="text-accent-hi hover:underline">{t('system.openDeployment')}</a>}
              <a href={updateGuideUrl()} target="_blank" rel="noopener noreferrer" className="text-accent-hi hover:underline">{t('system.guide')}</a>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
