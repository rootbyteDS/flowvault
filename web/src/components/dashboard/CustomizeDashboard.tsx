import { useState } from 'react';
import { defaultDashboardLayout, type DashboardLayout } from '../../../../shared/dashboard.ts';
import { api } from '../../api.ts';
import { t } from '../../i18n.tsx';
import { Button, ErrorBox, Modal } from '../ui.tsx';
import { WIDGET_TITLES } from '../../widget-titles.ts';
import { DASHBOARD_WIDGETS } from './widgets.tsx';

export function CustomizeDashboard({ layout, onClose, onSaved }: {
  layout: DashboardLayout;
  onClose: () => void;
  onSaved: (layout: DashboardLayout) => void;
}) {
  const [draft, setDraft] = useState(layout);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(undefined);
    try {
      const saved = await api<DashboardLayout>('/dashboard/layout', { method: 'PUT', body: draft });
      onSaved(saved);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return <Modal open onClose={() => { if (!saving) onClose(); }} title={t('dashboard.customize.title')} footer={<>
    <Button onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
    <Button variant="primary" loading={saving} onClick={() => void save()}>{t('common.save')}</Button>
  </>}>
    <p className="mb-5 text-sm text-muted">{t('dashboard.customize.hint')}</p>
    {error && <div className="mb-4"><ErrorBox>{error}</ErrorBox></div>}
    <fieldset disabled={saving} className="space-y-1">
      {draft.order.map((id) => DASHBOARD_WIDGETS.find((widget) => widget.id === id)!).map((widget) => (
        <label key={widget.id} className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2.5 hover:bg-panel-3">
          <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-accent-strong"
            checked={draft.widgets[widget.id].visible}
            onChange={(e) => setDraft({ ...draft, widgets: { ...draft.widgets, [widget.id]: { visible: e.target.checked } } })}
          />
          <span className="text-sm">
            {t(WIDGET_TITLES[widget.id])}
            {widget.hint && <span className="mt-1 block text-xs text-dim">{t(widget.hint)}</span>}
          </span>
        </label>
      ))}
    </fieldset>
    <div className="mt-5 border-t border-line pt-4">
      <Button size="sm" onClick={() => setDraft(defaultDashboardLayout())} disabled={saving}>{t('dashboard.customize.reset')}</Button>
    </div>
  </Modal>;
}
