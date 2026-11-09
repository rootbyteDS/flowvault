import { Router } from 'express';
import { defaultDashboardLayout, isDashboardLayoutInput, normalizeDashboardLayout } from '../shared/dashboard.ts';
import { fail } from '../shared/i18n/server.ts';
import { getSetting, setSetting } from './db.ts';

// FlowVault currently has one admin account. Keep preferences out of session data
// so logging out, changing credentials or switching devices preserves the layout.
const SETTING = 'admin_dashboard_layout';

export function createDashboardRouter() {
  const router = Router();
  router.get('/layout', (_req, res) => {
    let layout = defaultDashboardLayout();
    const stored = getSetting(SETTING);
    try { layout = normalizeDashboardLayout(JSON.parse(stored ?? 'null')); } catch {}
    res.json(layout);
  });
  router.put('/layout', (req, res) => {
    if (!isDashboardLayoutInput(req.body)) fail(400, 'dashboard.customize.invalid');
    const layout = normalizeDashboardLayout(req.body);
    setSetting(SETTING, JSON.stringify(layout));
    res.json(layout);
  });
  return router;
}
