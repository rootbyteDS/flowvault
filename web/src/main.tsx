import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
// Schriften lokal ausgeliefert – kein Abruf bei Google (DSGVO)
import '@fontsource-variable/archivo/wdth.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './index.css';
import { api } from './api.ts';
import { I18nProvider, t, useI18n } from './i18n.tsx';
import { isLocale } from '../../shared/i18n/index.ts';
import { Layout } from './components/Layout.tsx';
import { PageLoader, ToastProvider } from './components/ui.tsx';
import { Login } from './pages/Login.tsx';
import type { AuthStatus } from '../../shared/auth.ts';
import { Dashboard } from './pages/Dashboard.tsx';
import { Instances } from './pages/Instances.tsx';
import { InstanceDetail } from './pages/InstanceDetail.tsx';
import { Workflows } from './pages/Workflows.tsx';
import { WorkflowDetail } from './pages/WorkflowDetail.tsx';
import { Compare } from './pages/Compare.tsx';
import { Promote } from './pages/Promote.tsx';
import { ActivityPage } from './pages/Activity.tsx';
import { SettingsPage } from './pages/Settings.tsx';

function App() {
  const [auth, setAuth] = useState<AuthStatus>();
  const { setServerDefault } = useI18n();
  const check = useCallback(
    () =>
      api<AuthStatus>('/auth/status').then((a) => {
        setServerDefault(isLocale(a.defaultLanguage) ? a.defaultLanguage : undefined);
        setAuth(a);
      }),
    [setServerDefault],
  );

  useEffect(() => {
    check();
    const onUnauth = () => setAuth((a) => (a ? { ...a, authenticated: false } : a));
    window.addEventListener('fv:unauthorized', onUnauth);
    return () => window.removeEventListener('fv:unauthorized', onUnauth);
  }, [check]);

  if (!auth) return <PageLoader />;
  if (!auth.authenticated || auth.emailRequired) return <Login key={`${auth.authenticated}:${auth.setup}`} status={auth} onDone={check} />;

  return (
    <Routes>
      <Route element={<Layout onLogout={check} />}>
        <Route index element={<Dashboard />} />
        <Route path="instances" element={<Instances />} />
        <Route path="instances/:id" element={<InstanceDetail />} />
        <Route path="workflows" element={<Workflows />} />
        <Route path="workflows/:id" element={<WorkflowDetail />} />
        <Route path="promote" element={<Promote />} />
        <Route path="compare" element={<Compare />} />
        <Route path="activity" element={<ActivityPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<div className="py-20 text-center text-muted">{t('common.pageNotFound')}</div>} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <BrowserRouter>
        <ToastProvider>
          <App />
        </ToastProvider>
      </BrowserRouter>
    </I18nProvider>
  </StrictMode>,
);
