import { useState } from 'react';
import type { AuthStatus } from '../../../shared/auth.ts';
import { api } from '../api.ts';
import { Logo } from '../components/Layout.tsx';
import { Button, ErrorBox, Field, inputCls } from '../components/ui.tsx';
import { cx } from '../util.ts';

export function Login({ status, onDone }: { status: AuthStatus; onDone: () => void | Promise<void> }) {
  const setup = !status.setup;
  const migration = !!status.authenticated && !!status.emailRequired;
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [twoFactor, setTwoFactor] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [factor, setFactor] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    if (setup && pw !== pw2) return setError('Die Passwörter stimmen nicht überein');
    setBusy(true);
    try {
      if (twoFactor) {
        await api('/auth/login/verify', { body: { factor } });
      } else if (migration) {
        await api('/auth/email', { body: { email, current: pw } });
      } else {
        const result = await api<{ twoFactorRequired?: boolean }>(setup ? '/auth/setup' : '/auth/login', {
          body: setup ? { code, email, password: pw } : { email, password: pw },
        });
        if (result.twoFactorRequired) {
          setPw('');
          setTwoFactor(true);
          return;
        }
      }
      await onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-sm animate-enter">
        <Logo className="mb-8 text-center text-2xl" />
        <div className="rounded-2xl border border-line bg-panel p-6">
          <h1 className="text-lg font-medium">{setup ? 'FlowVault einrichten' : migration ? 'Admin-Konto vervollständigen' : twoFactor ? 'Anmeldung bestätigen' : 'Anmelden'}</h1>
          <p className="mt-1 text-sm text-muted">
            {setup ? 'Lege E-Mail und Passwort für dein Admin-Konto fest. 2FA kannst du danach in den Einstellungen aktivieren.'
              : migration ? 'Hinterlege einmalig deine E-Mail und bestätige dein bisheriges Passwort. Künftig meldest du dich mit beiden an.'
                : twoFactor ? 'Bestätige die Anmeldung mit deiner Authenticator-App oder einem Wiederherstellungscode.'
                  : status.emailLogin ? 'Mit E-Mail und Passwort deines Admin-Kontos.' : 'Mit deinem bisherigen Admin-Passwort. Danach hinterlegst du deine E-Mail.'}
          </p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            {twoFactor ? (
              <>
                <Field label={recovery ? 'Wiederherstellungscode' : 'Authenticator-Code'} hint={recovery ? 'Jeder Wiederherstellungscode kann nur einmal verwendet werden.' : 'Der sechsstellige Code aus deiner App. Die Anmeldung ist fünf Minuten gültig.'}>
                  <input key={String(recovery)} autoFocus required className={cx(inputCls, 'font-mono')} autoComplete="one-time-code" inputMode={recovery ? 'text' : 'numeric'} pattern={recovery ? undefined : '[0-9 ]{6,7}'} value={factor} onChange={(e) => setFactor(e.target.value)} />
                </Field>
                <Button type="button" variant="ghost" size="sm" onClick={() => { setRecovery(!recovery); setFactor(''); setError(undefined); }}>
                  {recovery ? 'Authenticator-App verwenden' : 'Wiederherstellungscode verwenden'}
                </Button>
              </>
            ) : (
              <>
                {setup && (
                  <Field label="Einrichtungscode" hint={<>Steht beim Start im Server-Log, z. B. mit <code className="font-mono text-muted">docker logs flowvault</code>.</>}>
                    <input autoFocus required autoComplete="off" spellCheck={false} className={cx(inputCls, 'font-mono uppercase')} value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXX-XXXX-XXXX" />
                  </Field>
                )}
                {(setup || migration || status.emailLogin) && (
                  <Field label="Admin-E-Mail">
                    <input type="email" required autoFocus={!setup} autoComplete="username" maxLength={254} className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} />
                  </Field>
                )}
                <Field label={migration ? 'Bisheriges Passwort' : 'Passwort'}>
                  <input type="password" required autoFocus={!setup && !migration && !status.emailLogin} autoComplete={setup ? 'new-password' : 'current-password'} minLength={setup ? 8 : undefined} maxLength={1024} className={inputCls} value={pw} onChange={(e) => setPw(e.target.value)} placeholder={setup ? 'Mindestens 8 Zeichen' : ''} />
                </Field>
                {setup && (
                  <Field label="Passwort wiederholen">
                    <input type="password" required autoComplete="new-password" minLength={8} maxLength={1024} className={inputCls} value={pw2} onChange={(e) => setPw2(e.target.value)} />
                  </Field>
                )}
              </>
            )}
            {error && <ErrorBox>{error}</ErrorBox>}
            <Button type="submit" variant="primary" className="w-full" loading={busy}>
              {setup ? 'Einrichten' : migration ? 'Admin-Konto speichern' : twoFactor ? 'Bestätigen' : 'Anmelden'}
            </Button>
            {twoFactor && (
              <Button type="button" variant="ghost" className="w-full" disabled={busy} onClick={() => { setTwoFactor(false); setFactor(''); setError(undefined); }}>
                Zurück zur Anmeldung
              </Button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
