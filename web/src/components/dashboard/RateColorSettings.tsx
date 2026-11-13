import { useId, useState } from 'react';
import { DEFAULT_RATE_THRESHOLDS, isRateThresholds, type RateThresholds } from '../../execution-history.ts';
import { t, type MessageKey } from '../../i18n.tsx';
import { Button, Field } from '../ui.tsx';

const labels: MessageKey[] = ['dashboard.executions.greenLimit', 'dashboard.executions.yellowLimit', 'dashboard.executions.amberLimit', 'dashboard.executions.orangeLimit'];
const colors = ['bg-emerald-500', 'bg-yellow-400', 'bg-amber-500', 'bg-orange-500'];

export function RateColorSettings({ thresholds, onChange }: { thresholds: RateThresholds; onChange: (value: RateThresholds) => void }) {
  const [draft, setDraft] = useState(() => thresholds.map(String));
  const id = useId();
  const valid = draft.every((s) => s.trim() !== '') && isRateThresholds(draft.map(Number));
  function edit(index: number, value: string) {
    const next = draft.map((s, i) => i === index ? value : s);
    setDraft(next);
    const numbers = next.map(Number);
    if (next.every((s) => s.trim() !== '') && isRateThresholds(numbers)) onChange(numbers);
  }
  return <fieldset className="space-y-3 border-t border-line pt-3">
    <legend className="text-sm font-medium">{t('dashboard.executions.colorLimits')}</legend>
    <p id={`${id}-hint`} className="text-xs text-dim">{t('dashboard.executions.colorHint')}</p>
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 130px), 1fr))' }}>
      {labels.map((label, i) => <Field key={label} label={t(label)}>
        <div className="flex items-center gap-2">
          <span aria-hidden className={`size-3 shrink-0 rounded-[2px] ${colors[i]}`} />
          <input type="number" min={i === 0 ? 0 : 0.01} max={99.99} step={0.01} value={draft[i]} onChange={(e) => edit(i, e.target.value)}
            aria-label={t(label)} aria-invalid={!valid} aria-describedby={`${id}-hint${valid ? '' : ` ${id}-error`}`}
            className="h-9 w-full min-w-0 rounded-lg border border-line-2 bg-sidebar px-2 text-sm text-text outline-none focus:border-accent" />
        </div>
      </Field>)}
    </div>
    {!valid && <p id={`${id}-error`} role="alert" className="text-xs text-del">{t('dashboard.executions.invalidLimits')}</p>}
    <Button size="sm" onClick={() => {
      setDraft(DEFAULT_RATE_THRESHOLDS.map(String));
      onChange([...DEFAULT_RATE_THRESHOLDS]);
    }}>{t('dashboard.executions.resetLimits')}</Button>
  </fieldset>;
}
