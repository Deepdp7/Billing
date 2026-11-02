import React, { useState } from 'react';
import { get, qs } from '../api';
import { Alert, Card, Field, Input, PageHeader, Select, Table, fmtAgo, fmtDate, useAsync } from '../components/ui';

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function UsagePage() {
  const [f, setF] = useState({ customerId: '', installationId: '', feature: '', licenseType: '', from: iso(new Date(Date.now() - 30 * 86400000)), to: iso(new Date()) });
  const customers = useAsync(() => get('/customers'), []);
  const installations = useAsync(() => get(`/installations${qs({ customerId: f.customerId })}`), [f.customerId]);
  const { data, error } = useAsync(() => get(`/usage${qs(f)}`), [JSON.stringify(f)]);
  const daily = useAsync(() => get(`/usage${qs({ ...f, groupBy: 'day' })}`), [JSON.stringify(f)]);
  const max = Math.max(1, ...(daily.data?.rows || []).map((r: any) => r.count));
  const used = new Set((data?.byFeature || []).map((b: any) => b.feature_key));
  const unused = (data?.features || []).filter((x: any) => !used.has(x.key));

  return (
    <div className="space-y-4">
      <PageHeader title="Feature Usage Analytics" subtitle="Privacy-conscious: only feature name, day and operation count are collected — never invoices, customers or amounts." />
      <Card>
        <div className="grid sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <Field label="Customer"><Select value={f.customerId} onChange={(e) => setF({ ...f, customerId: e.target.value, installationId: '' })}>
            <option value="">All customers</option>{customers.data?.data.map((c: any) => <option key={c.id} value={c.id}>{c.business_name || c.name}</option>)}</Select></Field>
          <Field label="Installation"><Select value={f.installationId} onChange={(e) => setF({ ...f, installationId: e.target.value })}>
            <option value="">All devices</option>{installations.data?.data.map((i: any) => <option key={i.id} value={i.id}>{i.device_name} ({i.customer_name})</option>)}</Select></Field>
          <Field label="Feature"><Select value={f.feature} onChange={(e) => setF({ ...f, feature: e.target.value })}>
            <option value="">All features</option>{(data?.features || []).map((x: any) => <option key={x.key} value={x.key}>{x.name}</option>)}</Select></Field>
          <Field label="License type"><Select value={f.licenseType} onChange={(e) => setF({ ...f, licenseType: e.target.value })}>
            <option value="">Any</option><option value="TRIAL">Trial</option><option value="PAID">Paid</option></Select></Field>
          <Field label="From"><Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
          <Field label="To"><Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
        </div>
      </Card>
      <Alert>{error}</Alert>
      <Card title="Daily activity">
        {(daily.data?.rows || []).length === 0 ? <p className="text-xs text-slate-400">No activity in this range.</p> : (
          <div className="flex items-end gap-0.5 h-32">
            {daily.data!.rows.map((r: any) => (
              <div key={r.usage_date} className="flex-1 bg-emerald-500/80 hover:bg-emerald-600 rounded-t min-w-[3px]" style={{ height: `${(r.count / max) * 100}%` }} title={`${r.usage_date}: ${r.count}`} />
            ))}
          </div>
        )}
      </Card>
      <Card title="By feature">
        <Table rows={data?.byFeature} empty="No usage in this range" columns={[
          { key: 'feature_key', label: 'Feature', render: (r) => (data.features.find((x: any) => x.key === r.feature_key)?.name || r.feature_key) },
          { key: 'count', label: 'Operations', render: (r) => r.count.toLocaleString('en-IN') },
          { key: 'installations', label: 'Devices using it' },
          { key: 'active_days', label: 'Active days (frequency)' },
          { key: 'first_used', label: 'First used', render: (r) => fmtDate(r.first_used) },
          { key: 'last_used', label: 'Last used', render: (r) => fmtAgo(r.last_used) },
        ]} />
        {unused.length > 0 && <p className="text-[11px] text-slate-500 mt-2"><b>Not used in this range:</b> {unused.map((x: any) => x.name).join(', ')}</p>}
      </Card>
      <Card title="By customer">
        <Table rows={data?.rows} empty="No usage in this range" columns={[
          { key: 'customer_name', label: 'Customer' }, { key: 'feature_key', label: 'Feature' },
          { key: 'count', label: 'Operations', render: (r) => r.count.toLocaleString('en-IN') }, { key: 'last_used', label: 'Last used', render: (r) => fmtAgo(r.last_used) },
        ]} />
      </Card>
    </div>
  );
}
