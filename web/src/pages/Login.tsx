import { useState } from 'react';
import { api } from '../api.ts';
import { Logo } from '../components/Layout.tsx';
import { Button, ErrorBox, Field, inputCls } from '../components/ui.tsx';
import { cx } from '../util.ts';

export function Login({ setup, onDone }: { setup: boolean; onDone: () => void }) {
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    if (setup && pw !== pw2) return setError('Die Passwörter stimmen nicht überein');
    setBusy(true);
    try {
      await api(setup ? '/auth/setup' : '/auth/login', { body: setup ? { code, password: pw } : { password: pw } });
      onDone();
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
          <h1 className="text-lg font-medium">{setup ? 'FlowVault einrichten' : 'Anmelden'}</h1>
          <p className="mt-1 text-sm text-muted">
            {setup ? 'Lege das Admin-Passwort fest. Es schützt die gespeicherten API-Keys deiner n8n-Instanzen.' : 'Mit dem Admin-Passwort'}
          </p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            {setup && (
              <Field
                label="Einrichtungscode"
                hint={<>Steht beim Start im Server-Log, z. B. mit <code className="font-mono text-muted">docker logs flowvault</code>.</>}
              >
                <input
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  className={cx(inputCls, 'font-mono uppercase')}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="XXXX-XXXX-XXXX"
                />
              </Field>
            )}
            <Field label="Passwort">
              <input type="password" autoFocus={!setup} className={inputCls} value={pw} onChange={(e) => setPw(e.target.value)} placeholder={setup ? 'Mindestens 8 Zeichen' : ''} />
            </Field>
            {setup && (
              <Field label="Passwort wiederholen">
                <input type="password" className={inputCls} value={pw2} onChange={(e) => setPw2(e.target.value)} />
              </Field>
            )}
            {error && <ErrorBox>{error}</ErrorBox>}
            <Button type="submit" variant="primary" className="w-full" loading={busy}>
              {setup ? 'Einrichten' : 'Anmelden'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
