import { useState } from 'react';
import type { AuthStatus, TwoFactorEnrollment } from '../../../shared/auth.ts';
import { api, useApi } from '../api.ts';
import { Button, Card, ErrorBox, Field, inputCls, Status, useToast } from './ui.tsx';

export function ProofFields({ password, setPassword, factor, setFactor, twoFactor }: {
  password: string; setPassword: (v: string) => void; factor: string; setFactor: (v: string) => void; twoFactor?: boolean;
}) {
  return (
    <>
      <Field label="Aktuelles Passwort">
        <input type="password" required autoComplete="current-password" maxLength={1024} className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      {twoFactor && (
        <Field label="Authenticator- oder Wiederherstellungscode" hint="Verwende für jede Bestätigung einen neuen Code. App-Codes wechseln alle 30 Sekunden.">
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
      toast('Admin-E-Mail geändert. Andere Geräte wurden abgemeldet.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-6">
      <h2 className="text-base font-medium">Admin-Konto</h2>
      <p className="mt-2 text-sm text-muted">Ein Admin-Konto für diese FlowVault-Installation. Die E-Mail dient zur Anmeldung; es werden keine E-Mails versendet.</p>
      {status.envEmail ? (
        <p className="mt-4 break-words text-sm text-muted">{status.email} – gesetzt über <code className="font-mono text-text">ADMIN_EMAIL</code>.</p>
      ) : (
        <form onSubmit={save} className="mt-4 space-y-3">
          <Field label="Admin-E-Mail"><input type="email" required autoComplete="username" maxLength={254} className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <ProofFields password={password} setPassword={setPassword} factor={factor} setFactor={setFactor} twoFactor={status.twoFactor} />
          {error && <ErrorBox>{error}</ErrorBox>}
          <Button type="submit" variant="primary" loading={busy} disabled={email.trim().toLowerCase() === status.email}>E-Mail speichern</Button>
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
    if (next !== confirmation) return setError('Die Passwörter stimmen nicht überein');
    setBusy(true);
    try {
      await api('/auth/password', { body: { current: password, next, factor } });
      setPassword('');
      setNext('');
      setConfirmation('');
      setFactor('');
      await reload();
      toast('Passwort geändert. Andere Geräte wurden abgemeldet.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-6">
      <h2 className="text-base font-medium">Passwort ändern</h2>
      {status.envPassword ? (
        <p className="mt-3 text-sm text-muted">Das Passwort wird über <code className="font-mono text-text">ADMIN_PASSWORD</code> gesetzt.</p>
      ) : (
        <form onSubmit={save} className="mt-4 space-y-3">
          <ProofFields password={password} setPassword={setPassword} factor={factor} setFactor={setFactor} twoFactor={status.twoFactor} />
          <Field label="Neues Passwort"><input type="password" required autoComplete="new-password" minLength={8} maxLength={1024} className={inputCls} value={next} onChange={(e) => setNext(e.target.value)} placeholder="Mindestens 8 Zeichen" /></Field>
          <Field label="Neues Passwort wiederholen"><input type="password" required autoComplete="new-password" minLength={8} maxLength={1024} className={inputCls} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} /></Field>
          {error && <ErrorBox>{error}</ErrorBox>}
          <Button type="submit" variant="primary" loading={busy}>Passwort speichern</Button>
        </form>
      )}
    </Card>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  function download() {
    const text = `FlowVault – Wiederherstellungscodes\n\nJeder Code kann nur einmal verwendet werden. Sicher getrennt vom Passwort aufbewahren.\n\n${codes.join('\n')}\n`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'flowvault-wiederherstellungscodes.txt';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="mt-5 space-y-4">
      <p className="text-sm text-muted">Diese zehn Codes werden nur jetzt angezeigt. Bewahre sie sicher und getrennt von deinem Passwort auf. Jeder Code ersetzt einmalig den Authenticator-Code; dein Passwort bleibt erforderlich.</p>
      <ul className="space-y-2 rounded-lg border border-line bg-sidebar p-3">
        {codes.map((code) => <li key={code} className="break-all font-mono text-xs select-all">{code}</li>)}
      </ul>
      <Button type="button" onClick={download}>Codes herunterladen</Button>
      <label className="flex items-start gap-2 text-sm text-muted"><input type="checkbox" className="mt-1" checked={saved} onChange={(e) => setSaved(e.target.checked)} />Ich habe die Wiederherstellungscodes sicher gespeichert.</label>
      <Button type="button" variant="primary" disabled={!saved} onClick={onDone}>Fertig</Button>
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
      toast(action === 'disable' ? '2FA deaktiviert. Andere Geräte wurden abgemeldet.' : action === 'enable' ? '2FA aktiviert. Sichere jetzt deine Wiederherstellungscodes.' : 'Neue Codes erstellt. Alle bisherigen Codes sind ungültig.');
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
        <h2 className="text-base font-medium">Zwei-Faktor-Authentifizierung</h2>
        <Status tone={status.twoFactor ? 'add' : 'neutral'}>{status.twoFactor ? 'Aktiv' : 'Nicht aktiviert'}</Status>
      </div>
      <p className="mt-2 text-sm text-muted">Schütze dein Admin-Konto zusätzlich mit einer Authenticator-App. Dafür ist kein Mailversand nötig.</p>
      {codes ? <RecoveryCodes codes={codes} onDone={() => setCodes(undefined)} /> : action ? (
        <form onSubmit={submit} className="mt-5 space-y-4">
          <h3 className="text-sm font-medium">{action === 'enable' ? '2FA einrichten' : action === 'disable' ? '2FA deaktivieren' : 'Wiederherstellungscodes erneuern'}</h3>
          {enrollment ? (
            <>
              <p className="text-sm text-muted">Scanne den QR-Code mit deiner Authenticator-App und bestätige mit dem angezeigten Code. Die Einrichtung ist zehn Minuten gültig.</p>
              <img src={enrollment.qrCode} width={256} height={256} alt="QR-Code zum Einrichten von FlowVault in einer Authenticator-App" className="max-w-full rounded-lg" />
              <Field label="Schlüssel für die manuelle Eingabe"><input readOnly value={enrollment.secret} className={`${inputCls} font-mono text-xs`} onFocus={(e) => e.target.select()} /></Field>
              <Field label="Authenticator-Code"><input autoFocus required autoComplete="one-time-code" inputMode="numeric" pattern="[0-9 ]{6,7}" className={inputCls} value={factor} onChange={(e) => setFactor(e.target.value)} /></Field>
            </>
          ) : (
            <>
              {action === 'recovery' && <p className="text-sm text-muted">Alle bisherigen Wiederherstellungscodes werden ungültig. Die neuen Codes werden einmalig angezeigt.</p>}
              <ProofFields password={password} setPassword={setPassword} factor={factor} setFactor={setFactor} twoFactor={status.twoFactor} />
            </>
          )}
          {error && <ErrorBox>{error}</ErrorBox>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant={action === 'disable' ? 'danger' : 'primary'} loading={busy}>{action === 'enable' ? enrollment ? '2FA aktivieren' : 'QR-Code erstellen' : action === 'disable' ? '2FA deaktivieren' : 'Neue Codes erstellen'}</Button>
            <Button type="button" disabled={busy} onClick={cancel}>Abbrechen</Button>
          </div>
        </form>
      ) : (
        <div className="mt-5 space-y-3">
          {status.twoFactor && <p className="text-sm text-muted">{status.recoveryCodesRemaining} Wiederherstellungscodes übrig. Bei Verlust deines Handys kannst du damit weiter auf dein Konto zugreifen.</p>}
          <div className="flex flex-wrap gap-2">
            {status.twoFactor ? (
              <>
                <Button onClick={() => setAction('recovery')}>Neue Wiederherstellungscodes</Button>
                <Button variant="danger" onClick={() => setAction('disable')}>2FA deaktivieren</Button>
              </>
            ) : <Button variant="primary" onClick={() => setAction('enable')}>2FA einrichten</Button>}
          </div>
        </div>
      )}
    </Card>
  );
}

export function AdminSettings() {
  const status = useApi<AuthStatus>('/auth/status');
  if (status.error) return <ErrorBox>{status.error}</ErrorBox>;
  if (!status.data) return <Card className="p-6 text-sm text-muted">Admin-Konto wird geladen …</Card>;
  return (
    <>
      <AccountCard status={status.data} reload={status.reload} />
      <PasswordCard status={status.data} reload={status.reload} />
      <TwoFactorCard status={status.data} reload={status.reload} />
    </>
  );
}
