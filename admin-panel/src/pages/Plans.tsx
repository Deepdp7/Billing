import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import { get, post, put } from '../api';
import { useApp } from '../App';
import { Alert, Badge, Button, Field, Input, Modal, PageHeader, Table, fmtINR, useAction, useAsync } from '../components/ui';

export function PlansPage() {
  const { can } = useApp();
  const { data, error, reload } = useAsync(() => get('/plans'), []);
  const features = useAsync(() => get('/features'), []);
  const [editing, setEditing] = useState<any | null>(null);
  const { busy, msg, run } = useAction();

  const save = () => run(async () => {
    const body = { name: editing.name, durationDays: editing.lifetime ? null : Number(editing.duration_days), pricePaise: Math.round(Number(editing.price) * 100),
      maxDevices: Number(editing.max_devices), features: editing.all ? ['*'] : editing.features, isActive: editing.is_active, sortOrder: Number(editing.sort_order) };
    if (editing.id) await put(`/plans/${editing.id}`, body);
    else await post('/plans', { ...body, code: editing.code });
    setEditing(null);
    reload();
  });
  const open = (p?: any) => setEditing(p
    ? { ...p, price: p.price_paise / 100, lifetime: p.duration_days === null, all: p.features.includes('*'), features: p.features.filter((f: string) => f !== '*') }
    : { code: '', name: '', duration_days: 30, price: 0, max_devices: 1, lifetime: false, all: true, features: [], is_active: true, sort_order: 10 });

  return (
    <div>
      <PageHeader title="Subscription Plans" subtitle="Plan-based permissions: which features each plan includes"
        actions={can('OWNER') && <Button tone="primary" onClick={() => open()}><Plus className="w-3.5 h-3.5" />New plan</Button>} />
      <Alert>{error}</Alert>
      <Table rows={data?.data} onRow={can('OWNER') ? open : undefined} columns={[
        { key: 'code', label: 'Code', render: (r) => <span className="font-mono">{r.code}</span> },
        { key: 'name', label: 'Name', render: (r) => <span className="inline-flex gap-1 items-center">{r.name}{r.is_trial && <Badge value="TRIAL" />}</span> },
        { key: 'duration_days', label: 'Duration', render: (r) => (r.duration_days ? `${r.duration_days} days` : 'Lifetime') },
        { key: 'price_paise', label: 'Price', render: (r) => fmtINR(r.price_paise) },
        { key: 'max_devices', label: 'Devices' },
        { key: 'features', label: 'Features', render: (r) => (r.features.includes('*') ? 'All features' : `${r.features.length} features`) },
        { key: 'is_active', label: 'Status', render: (r) => <Badge value={r.is_active ? 'ACTIVE' : 'DISABLED'} /> },
      ]} />
      {editing && (
        <Modal wide title={editing.id ? `Edit plan ${editing.code}` : 'New plan'} onClose={() => setEditing(null)}
          footer={<><Button onClick={() => setEditing(null)}>Cancel</Button><Button tone="primary" busy={busy} onClick={save}>Save plan</Button></>}>
          <Alert tone={msg?.tone}>{msg?.text}</Alert>
          <div className="grid grid-cols-3 gap-3">
            {!editing.id && <Field label="Code" hint="e.g. YEAR_1_PRO"><Input value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase() })} /></Field>}
            <Field label="Name"><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
            <Field label="Price (₹)"><Input type="number" value={editing.price} onChange={(e) => setEditing({ ...editing, price: e.target.value })} /></Field>
            <Field label="Duration (days)"><Input type="number" disabled={editing.lifetime} value={editing.duration_days ?? ''} onChange={(e) => setEditing({ ...editing, duration_days: e.target.value })} /></Field>
            <Field label="Device limit"><Input type="number" min={1} value={editing.max_devices} onChange={(e) => setEditing({ ...editing, max_devices: e.target.value })} /></Field>
            <Field label="Sort order"><Input type="number" value={editing.sort_order} onChange={(e) => setEditing({ ...editing, sort_order: e.target.value })} /></Field>
          </div>
          <div className="flex gap-4 text-xs">
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={editing.lifetime} onChange={(e) => setEditing({ ...editing, lifetime: e.target.checked })} />Lifetime (never expires)</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={editing.is_active} onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })} />Available for new licenses</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={editing.all} onChange={(e) => setEditing({ ...editing, all: e.target.checked })} />Include all features (incl. future ones)</label>
          </div>
          {!editing.all && (
            <div className="grid sm:grid-cols-2 gap-1 border border-slate-200 dark:border-slate-800 rounded-lg p-3 max-h-72 overflow-y-auto">
              {(features.data?.data || []).map((f: any) => (
                <label key={f.key} className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={editing.features.includes(f.key)}
                    onChange={(e) => setEditing({ ...editing, features: e.target.checked ? [...editing.features, f.key] : editing.features.filter((k: string) => k !== f.key) })} />
                  <span>{f.name}</span><span className="text-[10px] text-slate-400">{f.category}</span>
                </label>
              ))}
            </div>
          )}
          <p className="text-[11px] text-slate-500">Changes apply to every license on this plan when each installation next syncs.</p>
        </Modal>
      )}
    </div>
  );
}
