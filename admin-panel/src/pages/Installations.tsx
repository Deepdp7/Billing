import React, { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { get, post, qs } from '../api';
import { useApp } from '../App';
import { Alert, Badge, Button, Card, Input, PageHeader, Select, Table, fmtAgo, fmtDate, useAction, useAsync } from '../components/ui';
import { FeatureMatrix } from '../components/FeatureMatrix';
import { licenseStatusCell } from './Licenses';
import { promptDialog } from '../components/dialogs';

export function InstallationsPage() {
  const { nav } = useApp();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [seen, setSeen] = useState('');
  const { data, error } = useAsync(() => get(`/installations${qs({ search, status, seenWithinDays: seen })}`), [search, status, seen]);
  return (
    <div>
      <PageHeader title="Installations / Devices" subtitle="Every computer running Apna Billing" actions={<>
        <Input placeholder="Device, customer or ID…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-56" />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-36"><option value="">Any status</option>{['ACTIVE', 'SUSPENDED', 'DEACTIVATED'].map((s) => <option key={s}>{s}</option>)}</Select>
        <Select value={seen} onChange={(e) => setSeen(e.target.value)} className="w-40"><option value="">Seen any time</option><option value="1">Seen in 24 h</option><option value="7">Seen in 7 days</option><option value="30">Seen in 30 days</option></Select>
      </>} />
      <Alert>{error}</Alert>
      <Table rows={data?.data} onRow={(r) => nav('installations', r.id)} columns={[
        { key: 'device_name', label: 'Device', render: (r) => <><div className="font-semibold">{r.device_name}</div><div className="text-[10px] text-slate-400 font-mono">{r.id}</div></> },
        { key: 'customer_name', label: 'Customer', render: (r) => r.business_name || r.customer_name },
        { key: 'os', label: 'OS' },
        { key: 'app_version', label: 'Version' },
        { key: 'license_type', label: 'License', render: (r) => <span className="inline-flex gap-1"><Badge value={r.license_type} /><span>{r.plan_name}</span></span> },
        { key: 'license_status', label: 'License status', render: (r) => licenseStatusCell({ effective_status: r.license_effective_status, expires_at: r.expires_at }) },
        { key: 'status', label: 'Device', render: (r) => <span className="inline-flex gap-1"><Badge value={r.status} />{r.force_revalidate && <Badge value="REVALIDATE" />}</span> },
        { key: 'installed_at', label: 'Installed', render: (r) => fmtDate(r.installed_at) },
        { key: 'expires_at', label: 'Expires', render: (r) => (r.expires_at ? fmtDate(r.expires_at) : 'Lifetime') },
        { key: 'last_verified_at', label: 'Last verified', render: (r) => fmtAgo(r.last_verified_at) },
      ]} />
    </div>
  );
}

export function InstallationDetail({ id }: { id: string }) {
  const { nav, can } = useApp();
  const { data, error, reload } = useAsync(() => get(`/installations/${id}`), [id]);
  const { busy, msg, run } = useAction();
  const i = data?.installation;
  const act = async (action: string, label: string, ask = false) => {
    const reason = ask
      ? await promptDialog('This takes effect when the installation next connects.', {
        title: `${label}?`, label: 'Reason (recorded in audit log)', placeholder: 'Optional', danger: true, confirmText: label.replace(/\s*\(.*\)$/, ''),
      })
      : '';
    if (reason === null) return;
    run(async () => { await post(`/installations/${id}/${action}`, { reason: reason || undefined }); reload(); }, `${label}: applied when the installation next connects.`);
  };
  const enabled = data ? Object.entries(data.features).filter(([, f]: any) => f.enabled).map(([k]) => k) : [];
  const disabled = data ? Object.entries(data.features).filter(([, f]: any) => !f.enabled).map(([k]) => k) : [];
  return (
    <div className="space-y-4">
      <Button tone="ghost" onClick={() => nav('installations')}><ArrowLeft className="w-3.5 h-3.5" />Installations</Button>
      <Alert>{error}</Alert>
      <Alert tone={msg?.tone}>{msg?.text}</Alert>
      {i && (
        <>
          <PageHeader title={i.device_name} subtitle={`${data.customer.business_name || data.customer.name} · installation ${i.id}`} actions={<>
            {can('ADMIN') && i.status === 'ACTIVE' && <Button tone="warning" disabled={busy} onClick={() => act('suspend', 'Suspend device', true)}>Suspend</Button>}
            {can('ADMIN') && i.status !== 'ACTIVE' && <Button tone="primary" disabled={busy} onClick={() => act('activate', 'Activate device')}>Activate</Button>}
            {can('ADMIN') && i.status !== 'DEACTIVATED' && <Button tone="danger" disabled={busy} onClick={() => act('deactivate', 'Deactivate device (frees a device slot)', true)}>Deactivate</Button>}
            {can('SUPPORT') && !i.force_revalidate && <Button disabled={busy} onClick={() => act('force-revalidate', 'Force daily revalidation')}>Force revalidation</Button>}
            {can('SUPPORT') && i.force_revalidate && <Button disabled={busy} onClick={() => act('clear-revalidate', 'Clear forced revalidation')}>Clear revalidation</Button>}
            {can('ADMIN') && <Button disabled={busy} onClick={() => act('rotate-credentials', 'Rotate device credentials')}>Rotate credentials</Button>}
          </>} />
          <div className="grid md:grid-cols-3 gap-3">
            <Card title="Device">
              <dl className="text-xs grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
                <dt className="text-slate-500">Status</dt><dd><Badge value={i.status} /></dd>
                <dt className="text-slate-500">OS</dt><dd>{i.os}</dd>
                <dt className="text-slate-500">App version</dt><dd>{i.app_version}</dd>
                <dt className="text-slate-500">Installed</dt><dd>{fmtDate(i.installed_at, true)}</dd>
                <dt className="text-slate-500">Activated</dt><dd>{fmtDate(i.activated_at, true)}</dd>
                <dt className="text-slate-500">Last verified</dt><dd>{fmtDate(i.last_verified_at, true)} ({fmtAgo(i.last_verified_at)})</dd>
                <dt className="text-slate-500">Last activity</dt><dd>{fmtAgo(i.last_seen_at)}</dd>
                <dt className="text-slate-500">Last IP</dt><dd>{i.last_ip || '—'}</dd>
              </dl>
            </Card>
            <Card title="License">
              <dl className="text-xs grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
                <dt className="text-slate-500">Key</dt><dd><button className="font-mono text-indigo-600 dark:text-indigo-300 hover:underline" onClick={() => nav('licenses', data.license.id)}>{data.license.license_key}</button></dd>
                <dt className="text-slate-500">Type</dt><dd><Badge value={data.license.type} /> {data.plan.name}</dd>
                <dt className="text-slate-500">Status</dt><dd>{licenseStatusCell(data.license)}</dd>
                <dt className="text-slate-500">Expires</dt><dd>{data.license.expires_at ? fmtDate(data.license.expires_at) : 'Lifetime'}</dd>
                <dt className="text-slate-500">Customer</dt><dd><button className="text-indigo-600 dark:text-indigo-300 hover:underline" onClick={() => nav('customers', data.customer.id)}>{data.customer.name}</button></dd>
              </dl>
            </Card>
            <Card title="Features summary">
              <div className="text-xs"><div className="font-semibold text-emerald-700 dark:text-emerald-300 mb-1">Enabled ({enabled.length})</div><div className="text-slate-600 dark:text-slate-300 mb-2">{enabled.join(', ') || '—'}</div>
                <div className="font-semibold text-rose-700 dark:text-rose-300 mb-1">Disabled ({disabled.length})</div><div className="text-slate-600 dark:text-slate-300">{disabled.join(', ') || '—'}</div></div>
            </Card>
          </div>
          <Card title="Feature usage on this device">
            <Table rows={data.usage} empty="No usage reported yet" columns={[
              { key: 'feature_key', label: 'Feature' }, { key: 'count', label: 'Operations', render: (r) => r.count.toLocaleString('en-IN') },
              { key: 'active_days', label: 'Active days' }, { key: 'first_used', label: 'First used', render: (r) => fmtDate(r.first_used) },
              { key: 'last_used', label: 'Last used', render: (r) => fmtAgo(r.last_used) },
              { key: 'available', label: 'Available', render: (r) => <Badge value={data.features[r.feature_key]?.enabled ? 'ON' : 'OFF'} /> },
            ]} />
          </Card>
          <Card title="Device-specific feature permissions (highest priority)">
            <FeatureMatrix scope="INSTALLATION" scopeId={id} resolved={data.features} overrides={data.overrides} onChanged={reload} />
          </Card>
          <Card title="Device history">
            <Table rows={data.events} columns={[
              { key: 'created_at', label: 'When', render: (r) => fmtDate(r.created_at, true) },
              { key: 'event_type', label: 'Event', render: (r) => <Badge value={r.event_type} /> },
              { key: 'details', label: 'Details', render: (r) => <span className="text-slate-500">{Object.entries(r.details || {}).filter(([, v]) => v != null).map(([k, v]) => `${k}: ${v}`).join(' · ')}</span> },
            ]} />
          </Card>
        </>
      )}
    </div>
  );
}
