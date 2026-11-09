import { useState } from 'react';
import type { AuthStatus } from '../../../shared/auth.ts';
import { api } from '../api.ts';
import { Logo } from '../components/Layout.tsx';
import { Button, ErrorBox, Field, inputCls } from '../components/ui.tsx';
import { cx } from '../util.ts';
import { LanguageSelect } from '../components/LanguageSelect.tsx';
import { rich, t } from '../i18n.tsx';

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
    if (setup && pw !== pw2) return setError(t('auth.passwordMismatch'));
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
          <h1 className="text-lg font-medium">{t(setup ? 'auth.setupTitle' : migration ? 'auth.migrationTitle' : twoFactor ? 'auth.verifyTitle' : 'auth.loginTitle')}</h1>
          <p className="mt-1 text-sm text-muted">
            {t(setup ? 'auth.setupText' : migration ? 'auth.migrationText' : twoFactor ? 'auth.verifyText' : status.emailLogin ? 'auth.loginTextEmail' : 'auth.loginTextLegacy')}
          </p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            {twoFactor ? (
              <>
                <Field label={t(recovery ? 'auth.recoveryCode' : 'auth.authenticatorCode')} hint={t(recovery ? 'auth.recoveryHint' : 'auth.authenticatorHint')}>
                  <input key={String(recovery)} autoFocus required className={cx(inputCls, 'font-mono')} autoComplete="one-time-code" inputMode={recovery ? 'text' : 'numeric'} pattern={recovery ? undefined : '[0-9 ]{6,7}'} value={factor} onChange={(e) => setFactor(e.target.value)} />
                </Field>
                <Button type="button" variant="ghost" size="sm" onClick={() => { setRecovery(!recovery); setFactor(''); setError(undefined); }}>
                  {t(recovery ? 'auth.useAuthenticator' : 'auth.useRecovery')}
                </Button>
              </>
            ) : (
              <>
                {setup && (
                  <Field label={t('auth.setupCode')} hint={rich('auth.setupCodeHint', { code: (c) => <code className="font-mono text-muted">{c}</code> })}>
                    <input autoFocus required autoComplete="off" spellCheck={false} className={cx(inputCls, 'font-mono uppercase')} value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXX-XXXX-XXXX" />
                  </Field>
                )}
                {(setup || migration || status.emailLogin) && (
                  <Field label={t('auth.adminEmail')}>
                    <input type="email" required autoFocus={!setup} autoComplete="username" maxLength={254} className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} />
                  </Field>
                )}
                <Field label={t(migration ? 'auth.oldPassword' : 'auth.password')}>
                  <input type="password" required autoFocus={!setup && !migration && !status.emailLogin} autoComplete={setup ? 'new-password' : 'current-password'} minLength={setup ? 8 : undefined} maxLength={1024} className={inputCls} value={pw} onChange={(e) => setPw(e.target.value)} placeholder={setup ? t('auth.passwordPlaceholder') : ''} />
                </Field>
                {setup && (
                  <Field label={t('auth.passwordRepeat')}>
                    <input type="password" required autoComplete="new-password" minLength={8} maxLength={1024} className={inputCls} value={pw2} onChange={(e) => setPw2(e.target.value)} />
                  </Field>
                )}
              </>
            )}
            {error && <ErrorBox>{error}</ErrorBox>}
            <Button type="submit" variant="primary" className="w-full" loading={busy}>
              {t(setup ? 'auth.submitSetup' : migration ? 'auth.submitMigration' : twoFactor ? 'auth.submitVerify' : 'auth.submitLogin')}
            </Button>
            {twoFactor && (
              <Button type="button" variant="ghost" className="w-full" disabled={busy} onClick={() => { setTwoFactor(false); setFactor(''); setError(undefined); }}>
                {t('auth.backToLogin')}
              </Button>
            )}
          </form>
        </div>
        <LanguageSelect className="mx-auto mt-6 flex w-44" />
      </div>
    </div>
  );
}
