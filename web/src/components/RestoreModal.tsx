import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { AlertTriangle, Copy, RotateCcw } from 'lucide-react';
import { api, useApi, type Instance } from '../api.ts';
import { Button, ErrorBox, Field, Modal, inputCls, useToast } from './ui.tsx';
import { cx } from '../util.ts';

export function RestoreModal({ open, onClose, versionId, versionNumber, workflowName, instanceId, deleted, onDone }: {
  open: boolean;
  onClose: () => void;
  versionId: number;
  versionNumber: number;
  workflowName: string;
  instanceId: number;
  deleted: boolean;
  onDone: () => void;
}) {
  const toast = useToast();
  const nav = useNavigate();
  const instances = useApi<Instance[]>(open ? '/instances' : null);
  const [mode, setMode] = useState<'overwrite' | 'copy'>('overwrite');
  const [target, setTarget] = useState(instanceId);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) return;
    setMode(deleted ? 'copy' : 'overwrite');
    setTarget(instanceId);
    setName(`${workflowName} (v${versionNumber})`);
    setError(undefined);
  }, [open, deleted, instanceId, workflowName, versionNumber]);

  async function go() {
    setBusy(true);
    setError(undefined);
    try {
      const r = await api<{ workflowId?: number; mapped?: number }>(`/versions/${versionId}/restore`, { body: { mode, targetInstanceId: target, name } });
      const mapped = r.mapped ?? 0;
      toast(
        mode === 'overwrite'
          ? `Version ${versionNumber} wurde in n8n wiederhergestellt`
          : mapped
            ? `Workflow wurde als Kopie angelegt · ${mapped} Zuordnung${mapped > 1 ? 'en' : ''} angewandt`
            : 'Workflow wurde als Kopie in n8n angelegt',
      );
      onClose();
      onDone();
      if (mode === 'copy' && r.workflowId) nav(`/workflows/${r.workflowId}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const Option = ({ value, icon: Icon, title, text, disabled }: { value: 'overwrite' | 'copy'; icon: typeof Copy; title: string; text: string; disabled?: boolean }) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => setMode(value)}
      className={cx(
        'flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        mode === value ? 'border-accent bg-panel-3' : 'border-line-2 hover:bg-panel-2',
      )}
    >
      <Icon className={cx('mt-0.5 size-4 shrink-0', mode === value ? 'text-text' : 'text-dim')} />
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="mt-0.5 text-xs text-muted">{text}</div>
      </div>
    </button>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Version ${versionNumber} wiederherstellen`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" loading={busy} onClick={go}>{mode === 'overwrite' ? 'Wiederherstellen' : 'Kopie anlegen'}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Option value="overwrite" icon={RotateCcw} title="Workflow in n8n überschreiben" text="Ersetzt den aktuellen Stand. Der bisherige Stand bleibt in FlowVault gesichert." disabled={deleted} />
        <Option value="copy" icon={Copy} title="Als neuen Workflow anlegen" text="Auch auf einer anderen Instanz, z. B. von Staging nach Produktion" />
        {mode === 'copy' && (
          <div className="grid gap-3 pt-1 sm:grid-cols-2">
            <Field label="Ziel-Instanz">
              <select className={inputCls} value={target} onChange={(e) => setTarget(Number(e.target.value))}>
                {instances.data?.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </Field>
            <Field label="Name">
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          </div>
        )}
        <div className="flex gap-2 rounded-lg bg-panel-3 px-3 py-3 text-xs leading-5 text-muted">
          <AlertTriangle className="size-4 shrink-0 text-mod" />
          <span>
            {mode === 'copy' && target !== instanceId ? (
              <>
                Gespeicherte <b className="text-text">Zuordnungen</b> (Umgebungen) werden angewandt – fehlende IDs bleiben
                unverändert und lassen sich unter <b className="text-text">Umgebungen</b> pflegen.
              </>
            ) : (
              <>Credentials werden nur referenziert. Auf einer anderen Instanz müssen sie dort unter gleichem Namen existieren bzw. neu zugewiesen werden.</>
            )}{' '}
            Neu angelegte Workflows sind zunächst inaktiv.
          </span>
        </div>
        {error && <ErrorBox>{error}</ErrorBox>}
      </div>
    </Modal>
  );
}
