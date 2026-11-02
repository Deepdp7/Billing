import React, { useState } from 'react';
import { put, del } from '../api';
import { Alert, Badge, Button, Input, Modal, fmtDate, useAction, useAsync } from './ui';
import { get } from '../api';
import { useApp } from '../App';

export interface Resolved { enabled: boolean; expiresAt: string | null; source: string }
type Scope = 'GLOBAL' | 'CUSTOMER' | 'LICENSE' | 'INSTALLATION';

/**
 * Per-scope feature control. Shows the effective value (after inheritance) and lets admins override it at this
 * scope: enable, disable/suspend, grant temporarily, or reset (restore the inherited value).
 */
export function FeatureMatrix({ scope, scopeId, resolved, overrides, onChanged }: {
  scope: Scope; scopeId?: string; resolved?: Record<string, Resolved>; overrides: any[]; onChanged: () => void;
}) {
  const { can } = useApp();
  const catalog = useAsync(() => get<{ data: any[] }>('/features'), []);
  const { busy, msg, run } = useAction();
  const [temp, setTemp] = useState<{ key: string; name: string } | null>(null);
  const [days, setDays] = useState('7');
  const [reason, setReason] = useState('');
  const editable = can('ADMIN');

  const set = (featureKey: string, enabled: boolean, expiresAt?: string | null) =>
    run(async () => {
      await put('/feature-overrides', { scope, scopeId: scopeId || '', featureKey, enabled, expiresAt: expiresAt ?? null, reason: reason || undefined });
      onChanged();
    }, `${featureKey} ${enabled ? (expiresAt ? 'temporarily enabled' : 'enabled') : 'disabled'}. Applied when installations next sync.`);

  const reset = (o: any) => run(async () => { await del(`/feature-overrides/${o.id}`); onChanged(); }, `${o.feature_key} restored to inherited value`);

  const byKey = Object.fromEntries(overrides.map((o) => [o.feature_key, o]));
  const groups = [...new Set((catalog.data?.data || []).map((f: any) => f.category))];

  return (
    <div className="space-y-3">
      <Alert tone={msg?.tone}>{msg?.text}</Alert>
      {editable && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-500">Reason (recorded in audit log):</span>
          <Input className="max-w-xs !py-1" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="optional" />
        </div>
      )}
      {groups.map((g) => (
        <div key={g} className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900">
          <div className="px-3 py-1.5 bg-slate-50 dark:bg-slate-950/70 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{g}</div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {catalog.data!.data.filter((f: any) => f.category === g).map((f: any) => {
              const r = resolved?.[f.key];
              const o = byKey[f.key];
              const expired = o?.expires_at && Date.parse(o.expires_at) <= Date.now();
              return (
                <div key={f.key} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
                  <div className="flex-1 min-w-[180px]">
                    <div className="font-semibold text-slate-800 dark:text-slate-100">{f.name}</div>
                    <div className="text-[10px] text-slate-400">{f.key}</div>
                  </div>
                  {r && <Badge value={r.enabled ? 'ON' : 'OFF'} />}
                  {r && <span className="text-[10px] text-slate-400 w-24">via {r.source.toLowerCase()}{r.expiresAt ? ` until ${fmtDate(r.expiresAt)}` : ''}</span>}
                  {o ? (
                    <span className="text-[10px] text-indigo-600 dark:text-indigo-300 font-semibold w-40">
                      {scope.toLowerCase()} override: {o.enabled ? 'on' : 'off'}{o.expires_at ? ` · ${expired ? 'expired' : 'until'} ${fmtDate(o.expires_at)}` : ''}
                    </span>
                  ) : <span className="w-40" />}
                  {editable && (
                    <div className="flex gap-1">
                      <Button disabled={busy} onClick={() => set(f.key, true)}>Enable</Button>
                      <Button disabled={busy} onClick={() => set(f.key, false)}>Disable</Button>
                      <Button disabled={busy} onClick={() => { setTemp({ key: f.key, name: f.name }); setDays('7'); }}>Temporary…</Button>
                      <Button tone="ghost" disabled={busy || !o} onClick={() => o && reset(o)}>Reset</Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {temp && (
        <Modal title={`Temporary access: ${temp.name}`} onClose={() => setTemp(null)}
          footer={<><Button onClick={() => setTemp(null)}>Cancel</Button>
            <Button tone="primary" busy={busy} onClick={async () => {
              const ok = await set(temp.key, true, new Date(Date.now() + Number(days) * 86400000).toISOString());
              if (ok) setTemp(null);
            }}>Grant</Button></>}>
          <p className="text-xs text-slate-500">The feature switches off automatically when the period ends — even if the computer is offline.</p>
          <label className="text-xs font-semibold block">Days<Input type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} /></label>
        </Modal>
      )}
    </div>
  );
}
