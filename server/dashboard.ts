import { Router } from 'express';
import { defaultDashboardLayout, isDashboardLayoutInput, isWidgetId, normalizeDashboardLayout } from '../shared/dashboard.ts';
import { fail } from '../shared/i18n/server.ts';
import { getSetting, setSetting, tx } from './db.ts';

// FlowVault currently has one admin account. Keep preferences out of session data
// so logging out, changing credentials or switching devices preserves the layout.
const SETTING = 'admin_dashboard_layout';

function readLayout() {
  const stored = getSetting(SETTING);
  try { return normalizeDashboardLayout(JSON.parse(stored ?? 'null')); } catch { return defaultDashboardLayout(); }
}

export function createDashboardRouter() {
  const router = Router();
  router.get('/layout', (_req, res) => {
    res.json(readLayout());
  });
  router.put('/layout', (req, res) => {
    if (!isDashboardLayoutInput(req.body)) fail(400, 'dashboard.customize.invalid');
    const layout = normalizeDashboardLayout(req.body);
    setSetting(SETTING, JSON.stringify(layout));
    res.json(layout);
  });
  router.patch('/layout/widgets/:id', (req, res) => {
    const id = req.params.id;
    if (!isWidgetId(id) || !req.body || typeof req.body.visible !== 'boolean' || Object.keys(req.body).length !== 1) {
      fail(400, 'dashboard.customize.invalid');
    }
    // Merge on the server: a direct hide must not overwrite another widget's
    // more recent selection from a different tab/device.
    const layout = tx(() => {
      const current = readLayout();
      current.widgets[id].visible = req.body.visible;
      setSetting(SETTING, JSON.stringify(current));
      return current;
    });
    res.json(layout);
  });
  return router;
}
