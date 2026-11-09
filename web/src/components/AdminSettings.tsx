import { useState } from 'react';
import type { AuthStatus, TwoFactorEnrollment } from '../../../shared/auth.ts';
import { api, useApi } from '../api.ts';
import { Button, Card, ErrorBox, Field, inputCls, Status, useToast } from './ui.tsx';
import { rich, t } from '../i18n.tsx';

export function ProofFields({ password, setPassword, factor, setFactor, twoFactor }: {
  password: string; setPassword: (v: string) => void; factor: string; setFactor: (v: string) => void; twoFactor?: boolean;
}) {
  return (
    <>
      <Field label={t('account.proof.password')}>
        <input type="password" required autoComplete="current-password" maxLength={1024} className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      {twoFactor && (
        <Field label={t('account.proof.factor')} hint={t('account.proof.factorHint')}>
          <input required autoComplete="one-time-code" className={inputCls} value={factor} onChange={(e) => setFactor(e.target.value)} />
        </Field>
      )}
    </>
  );
}

type AccountProps = { status: AuthStatus; reload: () => Promise<unknown> };

function AccountCard({ status, reload }: AccountProps) {
  const toast = useToast();
  const [email, setEmail] = useState(status.email ?? '');
  const [password, setPassword] = useState('');
  const [factor, setFactor] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api('/auth/email', { body: { email, current: password, factor } });
      setPassword('');
      setFactor('');
      await reload();
      toast(t('account.email.changed'));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-6">
      <h2 className="text-base font-medium">{t('account.email.title')}</h2>
      <p className="mt-2 text-sm text-muted">{t('account.email.text')}</p>
      {status.envEmail ? (
        <p className="mt-4 break-words text-sm text-muted">{rich('account.email.fromEnv', { code: (c) => <code className="font-mono text-text">{c}</code> }, { email: status.email ?? '' })}</p>
      ) : (
        <form onSubmit={save} className="mt-4 space-y-3">
           <Field label={t('auth.adminEmail')}><input type="email" required autoComplete="username" maxLength={254} className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <ProofFields password={password} setPassword={setPassword} factor={factor} setFactor={setFactor} twoFactor={status.twoFactor} />
          {error && <ErrorBox>{error}</ErrorBox>}
          <Button type="submit" variant="primary" loading={busy} disabled={email.trim().toLowerCase() === status.email}>{t('account.email.save')}</Button>
        </form>
      )}
    </Card>
  );
}

function PasswordCard({ status, reload }: AccountProps) {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [next, setNext] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [factor, setFactor] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    if (next !== confirmation) return setError(t('auth.passwordMismatch'));
    setBusy(true);
    try {
      await api('/auth/password', { body: { current: password, next, factor } });
      setPassword('');
      setNext('');
      setConfirmation('');
      setFactor('');
      await reload();
      toast(t('account.password.changed'));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-6">
      <h2 className="text-base font-medium">{t('account.password.title')}</h2>
      {status.envPassword ? (
        <p className="mt-3 text-sm text-muted">{rich('account.password.fromEnv', { code: (c) => <code className="font-mono text-text">{c}</code> })}</p>
      ) : (
        <form onSubmit={save} className="mt-4 space-y-3">
          <ProofFields password={password} setPassword={setPassword} factor={factor} setFactor={setFactor} twoFactor={status.twoFactor} />
          <Field label={t('account.password.new')}><input type="password" required autoComplete="new-password" minLength={8} maxLength={1024} className={inputCls} value={next} onChange={(e) => setNext(e.target.value)} placeholder={t('auth.passwordPlaceholder')} /></Field>
          <Field label={t('account.password.repeat')}><input type="password" required autoComplete="new-password" minLength={8} maxLength={1024} className={inputCls} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} /></Field>
          {error && <ErrorBox>{error}</ErrorBox>}
          <Button type="submit" variant="primary" loading={busy}>{t('account.password.save')}</Button>
        </form>
      )}
    </Card>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  function download() {
    const text = `${t('account.recovery.fileTitle')}\n\n${t('account.recovery.fileText')}\n\n${codes.join('\n')}\n`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = t('account.recovery.fileName');
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="mt-5 space-y-4">
      <p className="text-sm text-muted">{t('account.recovery.intro')}</p>
      <ul className="space-y-2 rounded-lg border border-line bg-sidebar p-3">
        {codes.map((code) => <li key={code} className="break-all font-mono text-xs select-all">{code}</li>)}
      </ul>
      <Button type="button" onClick={download}>{t('account.recovery.download')}</Button>
      <label className="flex items-start gap-2 text-sm text-muted"><input type="checkbox" className="mt-1" checked={saved} onChange={(e) => setSaved(e.target.checked)} />{t('account.recovery.confirm')}</label>
      <Button type="button" variant="primary" disabled={!saved} onClick={onDone}>{t('account.recovery.done')}</Button>
    </div>
  );
}

function TwoFactorCard({ status, reload }: AccountProps) {
  const toast = useToast();
  const [action, setAction] = useState<'enable' | 'disable' | 'recovery'>();
  const [password, setPassword] = useState('');
  const [factor, setFactor] = useState('');
  const [enrollment, setEnrollment] = useState<TwoFactorEnrollment>();
  const [codes, setCodes] = useState<string[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  function reset() {
    setAction(undefined);
    setEnrollment(undefined);
    setPassword('');
    setFactor('');
    setError(undefined);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      if (action === 'enable' && !enrollment) {
        setEnrollment(await api<TwoFactorEnrollment>('/auth/2fa/setup', { body: { current: password } }));
        setPassword('');
        setFactor('');
        return;
      }
      const path = action === 'enable' ? '/auth/2fa/enable' : action === 'disable' ? '/auth/2fa/disable' : '/auth/2fa/recovery';
      const result = await api<{ codes?: string[] }>(path, { body: { current: password, factor } });
      reset();
      setCodes(result.codes);
      await reload();
      toast(t(action === 'disable' ? 'account.twoFactor.disabled' : action === 'enable' ? 'account.twoFactor.enabled' : 'account.twoFactor.codesCreated'));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    setError(undefined);
    try {
      if (enrollment) await api('/auth/2fa/cancel', { method: 'POST' });
      reset();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-medium">{t('account.twoFactor.title')}</h2>
        <Status tone={status.twoFactor ? 'add' : 'neutral'}>{t(status.twoFactor ? 'account.twoFactor.on' : 'account.twoFactor.off')}</Status>
      </div>
      <p className="mt-2 text-sm text-muted">{t('account.twoFactor.text')}</p>
      {codes ? <RecoveryCodes codes={codes} onDone={() => setCodes(undefined)} /> : action ? (
        <form onSubmit={submit} className="mt-5 space-y-4">
          <h3 className="text-sm font-medium">{t(action === 'enable' ? 'account.twoFactor.setupTitle' : action === 'disable' ? 'account.twoFactor.disableTitle' : 'account.twoFactor.recoveryTitle')}</h3>
          {enrollment ? (
            <>
              <p className="text-sm text-muted">{t('account.twoFactor.scan')}</p>
              <img src={enrollment.qrCode} width={256} height={256} alt={t('account.twoFactor.qrAlt')} className="max-w-full rounded-lg" />
              <Field label={t('account.twoFactor.manualKey')}><input readOnly value={enrollment.secret} className={`${inputCls} font-mono text-xs`} onFocus={(e) => e.target.select()} /></Field>
              <Field label={t('auth.authenticatorCode')}><input autoFocus required autoComplete="one-time-code" inputMode="numeric" pattern="[0-9 ]{6,7}" className={inputCls} value={factor} onChange={(e) => setFactor(e.target.value)} /></Field>
            </>
          ) : (
            <>
              {action === 'recovery' && <p className="text-sm text-muted">{t('account.twoFactor.recoveryWarning')}</p>}
              <ProofFields password={password} setPassword={setPassword} factor={factor} setFactor={setFactor} twoFactor={status.twoFactor} />
            </>
          )}
          {error && <ErrorBox>{error}</ErrorBox>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant={action === 'disable' ? 'danger' : 'primary'} loading={busy}>{t(action === 'enable' ? (enrollment ? 'account.twoFactor.enable' : 'account.twoFactor.createQr') : action === 'disable' ? 'account.twoFactor.disable' : 'account.twoFactor.newCodes')}</Button>
            <Button type="button" disabled={busy} onClick={cancel}>{t('common.cancel')}</Button>
          </div>
        </form>
      ) : (
        <div className="mt-5 space-y-3">
          {status.twoFactor && <p className="text-sm text-muted">{t('account.twoFactor.codesRemaining', { count: status.recoveryCodesRemaining ?? 0 })}</p>}
          <div className="flex flex-wrap gap-2">
            {status.twoFactor ? (
              <>
                <Button onClick={() => setAction('recovery')}>{t('account.twoFactor.newCodesButton')}</Button>
                <Button variant="danger" onClick={() => setAction('disable')}>{t('account.twoFactor.disable')}</Button>
              </>
            ) : <Button variant="primary" onClick={() => setAction('enable')}>{t('account.twoFactor.setupTitle')}</Button>}
          </div>
        </div>
      )}
    </Card>
  );
}

export function AdminSettings() {
  const status = useApi<AuthStatus>('/auth/status');
  if (status.error) return <ErrorBox>{status.error}</ErrorBox>;
  if (!status.data) return <Card className="p-6 text-sm text-muted">{t('account.loading')}</Card>;
  return (
    <>
      <AccountCard status={status.data} reload={status.reload} />
      <PasswordCard status={status.data} reload={status.reload} />
      <TwoFactorCard status={status.data} reload={status.reload} />
    </>
  );
}
