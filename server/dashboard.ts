import { Router } from 'express';
import { defaultDashboardLayout, isDashboardLayoutInput, isWidgetId, isWidgetOrder, isWidgetSizes, normalizeDashboardLayout, normalizeWidgetOrder } from '../shared/dashboard.ts';
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
    const layout = tx(() => {
      const next = normalizeDashboardLayout(req.body);
      // Older clients save visibility without knowing about widget ordering.
      if (req.body.order === undefined) next.order = readLayout().order;
      if (req.body.sizes === undefined) next.sizes = readLayout().sizes;
      setSetting(SETTING, JSON.stringify(next));
      return next;
    });
    res.json(layout);
  });
  router.patch('/layout/order', (req, res) => {
    if (!req.body || Object.keys(req.body).length !== 1 || !isWidgetOrder(req.body.order)) fail(400, 'dashboard.customize.invalid');
    const layout = tx(() => {
      const next = readLayout();
      next.order = normalizeWidgetOrder(req.body.order);
      setSetting(SETTING, JSON.stringify(next));
      return next;
    });
    res.json(layout);
  });
  router.patch('/layout/geometry', (req, res) => {
    if (!req.body || Object.keys(req.body).length !== 2 || !isWidgetOrder(req.body.order) || !isWidgetSizes(req.body.sizes)) {
      fail(400, 'dashboard.customize.invalid');
    }
    const layout = tx(() => {
      const next = readLayout();
      next.order = normalizeWidgetOrder(req.body.order);
      next.sizes = { ...next.sizes, ...req.body.sizes };
      setSetting(SETTING, JSON.stringify(next));
      return next;
    });
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
