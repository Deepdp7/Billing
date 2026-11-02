import React from 'react';
import { get } from '../api';
import { useApp } from '../App';
import { Alert, Badge, Card, PageHeader, Stat, Table, fmtAgo, fmtDate, daysLeft, useAsync, Button } from '../components/ui';

export function OverviewPage() {
  const { nav } = useApp();
  const { data, error, reload } = useAsync(() => get('/dashboard'), []);
  const s = data?.stats;
  const maxUsage = Math.max(1, ...(data?.featureUsage || []).map((f: any) => f.count));
  return (
    <div>
      <PageHeader title="Overview" subtitle="All installations of Apna Billing across your customers" actions={<Button onClick={reload}>Refresh</Button>} />
      <Alert>{error}</Alert>
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3 mb-5">
        <Stat label="Installations" value={s?.totalInstallations ?? '…'} hint={`${s?.activeInstallations ?? 0} active`} onClick={() => nav('installations')} />
        <Stat label="Seen last 24h" value={s?.seenLast24h ?? '…'} tone="emerald" onClick={() => nav('installations')} />
        <Stat label="Customers" value={s?.totalCustomers ?? '…'} onClick={() => nav('customers')} />
        <Stat label="Active trials" value={s?.activeTrials ?? '…'} tone="indigo" onClick={() => nav('trials')} />
        <Stat label="Active paid" value={s?.activePaid ?? '…'} tone="emerald" onClick={() => nav('paid')} />
        <Stat label="Licenses sold" value={s?.totalPaidLicenses ?? '…'} />
        <Stat label="Expired" value={s?.expired ?? '…'} tone="rose" onClick={() => nav('expired')} />
        <Stat label="Suspended" value={s?.suspended ?? '…'} tone="amber" onClick={() => nav('suspended')} />
        <Stat label="Revoked" value={s?.revoked ?? '…'} />
        <Stat label="Expiring ≤ 7 days" value={s?.expiringIn7Days ?? '…'} tone="amber" />
        <Stat label="Trials started" value={s?.totalTrials ?? '…'} />
        <Stat label="Trial conversion" value={s ? `${s.trialConversionRate}%` : '…'} hint={`${s?.trialConversions ?? 0} converted`} tone="indigo" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Upcoming expirations (30 days)">
          <Table rows={data?.upcomingExpirations} empty="No licenses expire in the next 30 days" onRow={(r) => nav('licenses', r.id)} columns={[
            { key: 'customer_name', label: 'Customer', render: (r) => <><div className="font-semibold">{r.business_name || r.customer_name}</div><div className="text-[10px] text-slate-400">{r.license_key}</div></> },
            { key: 'type', label: 'Type', render: (r) => <Badge value={r.type} /> },
            { key: 'plan_name', label: 'Plan' },
            { key: 'expires_at', label: 'Expires', render: (r) => <span>{fmtDate(r.expires_at)} <span className="text-amber-600 dark:text-amber-400 font-semibold">({daysLeft(r.expires_at)}d)</span></span> },
          ]} />
        </Card>
        <Card title="Feature usage (last 30 days)">
          {(data?.featureUsage || []).length === 0 && <p className="text-xs text-slate-400">No usage reported yet.</p>}
          <div className="space-y-1.5">
            {(data?.featureUsage || []).slice(0, 14).map((f: any) => (
              <div key={f.feature} className="flex items-center gap-2 text-xs">
                <span className="w-36 truncate text-slate-600 dark:text-slate-300">{f.feature}</span>
                <div className="flex-1 h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden"><div className="h-full bg-indigo-500 rounded-full" style={{ width: `${(f.count / maxUsage) * 100}%` }} /></div>
                <span className="w-24 text-right tabular-nums text-slate-700 dark:text-slate-200 font-semibold">{f.count.toLocaleString('en-IN')} <span className="text-slate-400 dark:text-slate-500 font-normal">/ {f.installations}</span></span>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Recent license activity" className="lg:col-span-2" actions={<Button tone="ghost" onClick={() => nav('events')}>View all</Button>}>
          <Table rows={data?.recentActivity} empty="No activity yet" columns={[
            { key: 'created_at', label: 'When', render: (r) => <span title={fmtDate(r.created_at, true)}>{fmtAgo(r.created_at)}</span> },
            { key: 'event_type', label: 'Event', render: (r) => <Badge value={r.event_type} /> },
            { key: 'customer_name', label: 'Customer' },
            { key: 'actor', label: 'By', render: (r) => (r.actor === 'client' ? 'Desktop app' : r.actor === 'system' ? 'System' : 'Admin') },
            { key: 'details', label: 'Details', render: (r) => <span className="text-slate-500">{Object.entries(r.details || {}).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => `${k}: ${v}`).join(' · ')}</span> },
          ]} />
        </Card>
      </div>
    </div>
  );
}
