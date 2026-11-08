import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
// Schriften lokal ausgeliefert – kein Abruf bei Google (DSGVO)
import '@fontsource-variable/archivo/wdth.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './index.css';
import { api } from './api.ts';
import { Layout } from './components/Layout.tsx';
import { PageLoader, ToastProvider } from './components/ui.tsx';
import { Login } from './pages/Login.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import { Instances } from './pages/Instances.tsx';
import { InstanceDetail } from './pages/InstanceDetail.tsx';
import { Workflows } from './pages/Workflows.tsx';
import { WorkflowDetail } from './pages/WorkflowDetail.tsx';
import { Compare } from './pages/Compare.tsx';
import { Promote } from './pages/Promote.tsx';
import { ActivityPage } from './pages/Activity.tsx';
import { SettingsPage } from './pages/Settings.tsx';

type AuthState = { setup: boolean; authenticated: boolean };

function App() {
  const [auth, setAuth] = useState<AuthState>();
  const check = useCallback(() => api<AuthState>('/auth/status').then(setAuth), []);

  useEffect(() => {
    check();
    const onUnauth = () => setAuth((a) => (a ? { ...a, authenticated: false } : a));
    window.addEventListener('fv:unauthorized', onUnauth);
    return () => window.removeEventListener('fv:unauthorized', onUnauth);
  }, [check]);

  if (!auth) return <PageLoader />;
  if (!auth.authenticated) return <Login setup={!auth.setup} onDone={check} />;

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
        <Route path="*" element={<div className="py-20 text-center text-muted">Seite nicht gefunden.</div>} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
