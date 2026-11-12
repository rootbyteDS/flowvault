import { useState } from 'react';
import { Copy, KeyRound } from 'lucide-react';
import { api, useApi, type Instance } from '../api.ts';
import type { McpCreatedToken, McpState, McpToken } from '../../../shared/mcp.ts';
import { Button, Card, ErrorBox, Field, InfoTip, Modal, Status, Switch, inputCls, useToast } from './ui.tsx';
import { paragraphs, t } from '../i18n.tsx';
import { cx, timeAgo } from '../util.ts';

function CopyButton({ value }: { value: string }) {
  const toast = useToast();
  return (
    <Button
      size="sm"
      icon={<Copy className="size-3.5" />}
      onClick={() => navigator.clipboard.writeText(value).then(() => toast(t('settings.mcp.copied')), () => undefined)}
    >
      {t('settings.mcp.copy')}
    </Button>
  );
}

function configExample(endpoint: string, token: string) {
  return JSON.stringify({ mcpServers: { flowvault: { type: 'http', url: endpoint, headers: { Authorization: `Bearer ${token}` } } } }, null, 2);
}

/** Zugang für KI-Agents: Ein/Aus, Adresse, Tokens pro Agent. Das Token selbst gibt es nur einmal, direkt nach dem Anlegen. */
export function McpSettings() {
  const toast = useToast();
  const st = useApi<McpState>('/mcp');
  const instances = useApi<Instance[]>('/instances');
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState<'toggle' | 'create' | number>();
  const [created, setCreated] = useState<McpCreatedToken>();
  const endpoint = `${window.location.origin}/mcp`;
  const instanceName = new Map((instances.data ?? []).map((i) => [i.id, i.name]));

  async function toggle(enabled: boolean) {
    setBusy('toggle');
    try {
      st.setData(await api<McpState>('/mcp', { method: 'PUT', body: { enabled } }));
      toast(t(enabled ? 'settings.mcp.enabled' : 'settings.mcp.disabled'));
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(undefined);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy('create');
    try {
      const r = await api<McpCreatedToken>('/mcp/tokens', { body: { name, instances: selected.length ? selected : null } });
      setCreated(r);
      setName('');
      setSelected([]);
      st.reload();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(undefined);
    }
  }

  async function revoke(token: McpToken) {
    if (!window.confirm(t('settings.mcp.revokeConfirm', { name: token.name }))) return;
    setBusy(token.id);
    try {
      await api(`/mcp/tokens/${token.id}`, { method: 'DELETE' });
      toast(t('settings.mcp.revoked'));
      st.reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(undefined);
    }
  }

  const s = st.data;
  const scopeLabel = (ids: number[] | null) =>
    ids === null
      ? t('settings.mcp.allInstances')
      : ids.map((id) => instanceName.get(id)).filter(Boolean).join(', ') || t('settings.mcp.someInstances', { count: ids.length });

  return (
    <Card className="p-6 md:col-span-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-medium">
          {t('settings.mcp.title')}
          <InfoTip label={t('settings.mcp.title')}>{paragraphs('settings.mcp.titleTip')}</InfoTip>
        </h2>
        {s && <Status tone={s.enabled ? 'add' : 'neutral'}>{t(s.enabled ? 'settings.mcp.on' : 'settings.mcp.off')}</Status>}
      </div>
      <p className="mt-2 max-w-3xl text-sm text-muted">{t('settings.mcp.intro')}</p>

      {st.error && !s && (
        <div className="mt-4">
          <ErrorBox>{t('settings.mcp.unavailable')}</ErrorBox>
        </div>
      )}

      {s && (
        <>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <Switch checked={s.enabled} onChange={(v) => busy !== 'toggle' && toggle(v)} label={t('settings.mcp.enable')} hint={t('settings.mcp.enableHint')} />
            <Field label={t('settings.mcp.endpoint')} hint={t('settings.mcp.endpointHint')}>
              <div className="flex items-center gap-2">
                <code className={cx(inputCls, 'flex items-center truncate font-mono')}>{endpoint}</code>
                <CopyButton value={endpoint} />
              </div>
            </Field>
          </div>

          <div className="mt-6">
            <h3 className="flex items-center gap-1.5 text-[13px] text-muted">
              {t('settings.mcp.tokens')}
              <InfoTip label={t('settings.mcp.tokens')}>{paragraphs('settings.mcp.tokensTip')}</InfoTip>
            </h3>
            {s.tokens.length === 0 ? (
              <p className="mt-2 text-sm text-dim">{t('settings.mcp.noTokens')}</p>
            ) : (
              <div className="mt-2 divide-y divide-line rounded-lg bg-panel-3 text-sm">
                {s.tokens.map((tok) => (
                  <div key={tok.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-medium">{tok.name}</span>
                        <span className="font-mono text-xs text-dim">{tok.hint}</span>
                      </div>
                      <div className="mt-0.5 text-xs text-dim">
                        {scopeLabel(tok.instances)} · {t('settings.mcp.created', { when: timeAgo(tok.createdAt) })} ·{' '}
                        {tok.lastUsedAt ? t('settings.mcp.lastUsed', { when: timeAgo(tok.lastUsedAt) }) : t('settings.mcp.neverUsed')}
                      </div>
                    </div>
                    <Button size="sm" variant="danger" loading={busy === tok.id} onClick={() => revoke(tok)}>
                      {t('settings.mcp.revoke')}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <form onSubmit={create} className="mt-6 border-t border-line pt-4">
            <h3 className="text-[13px] text-muted">{t('settings.mcp.newToken')}</h3>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <Field label={t('settings.mcp.name')}>
                <input required maxLength={60} className={inputCls} value={name} placeholder={t('settings.mcp.namePlaceholder')} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label={t('settings.mcp.instances')} hint={t('settings.mcp.instancesHint')}>
                <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1.5">
                  {(instances.data ?? []).map((i) => (
                    <label key={i.id} className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="accent-accent-strong"
                        checked={selected.includes(i.id)}
                        onChange={(e) => setSelected((cur) => (e.target.checked ? [...cur, i.id] : cur.filter((x) => x !== i.id)))}
                      />
                      {i.name}
                    </label>
                  ))}
                </div>
              </Field>
            </div>
            <div className="mt-4">
              <Button type="submit" variant="primary" icon={<KeyRound className="size-4" />} loading={busy === 'create'}>
                {t('settings.mcp.create')}
              </Button>
            </div>
          </form>
        </>
      )}

      <Modal
        open={!!created}
        onClose={() => setCreated(undefined)}
        title={created ? t('settings.mcp.createdTitle', { name: created.info.name }) : ''}
        width="max-w-2xl"
        footer={<Button variant="primary" onClick={() => setCreated(undefined)}>{t('settings.mcp.done')}</Button>}
      >
        {created && (
          <div className="space-y-4">
            <p className="text-sm text-mod">{t('settings.mcp.createdHint')}</p>
            <div className="flex items-center gap-2">
              <code className={cx(inputCls, 'flex items-center overflow-x-auto font-mono text-xs whitespace-nowrap')}>{created.token}</code>
              <CopyButton value={created.token} />
            </div>
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] text-muted">{t('settings.mcp.config')}</span>
                <CopyButton value={configExample(endpoint, created.token)} />
              </div>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-panel-3 p-3 font-mono text-xs">{configExample(endpoint, created.token)}</pre>
              <p className="mt-1 text-xs text-dim">{t('settings.mcp.configHint')}</p>
            </div>
          </div>
        )}
      </Modal>
    </Card>
  );
}
