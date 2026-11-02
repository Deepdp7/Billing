import React from 'react';
import { get, del } from '../api';
import { useApp } from '../App';
import { Alert, Badge, Button, Card, PageHeader, Table, fmtDate, useAction, useAsync } from '../components/ui';
import { FeatureMatrix } from '../components/FeatureMatrix';

export function FeaturesPage() {
  const { nav, can } = useApp();
  const global = useAsync(() => get('/feature-overrides?scope=GLOBAL'), []);
  const all = useAsync(() => get('/feature-overrides'), []);
  const { msg, run } = useAction();
  const reload = () => { global.reload(); all.reload(); };
  const target = (o: any) => {
    if (o.scope === 'CUSTOMER') return () => nav('customers', o.scope_id);
    if (o.scope === 'LICENSE') return () => nav('licenses', o.scope_id);
    if (o.scope === 'INSTALLATION') return () => nav('installations', o.scope_id);
    return undefined;
  };
  return (
    <div className="space-y-4">
      <PageHeader title="Feature Permissions"
        subtitle="Precedence (most specific wins): installation → license → customer → global → plan. Enforced by the desktop backend, not just hidden in the UI." />
      <Alert tone={msg?.tone}>{msg?.text}</Alert>
      <Card title="Global permissions (apply to every installation unless overridden more specifically)">
        <FeatureMatrix scope="GLOBAL" overrides={global.data?.data || []} onChanged={reload} />
      </Card>
      <Card title="All active overrides">
        <Table rows={all.data?.data} empty="No overrides — every installation uses its plan's features" columns={[
          { key: 'scope', label: 'Scope', render: (r) => <Badge value={r.scope} /> },
          { key: 'scope_id', label: 'Target', render: (r) => (r.scope === 'GLOBAL' ? 'Everyone'
            : <button className="font-mono text-indigo-600 dark:text-indigo-300 hover:underline" onClick={target(r)}>{r.scope_id.slice(0, 8)}…</button>) },
          { key: 'feature_key', label: 'Feature' },
          { key: 'enabled', label: 'Value', render: (r) => <Badge value={r.enabled ? 'ON' : 'OFF'} /> },
          { key: 'expires_at', label: 'Expires', render: (r) => (r.expires_at ? `${fmtDate(r.expires_at, true)}${Date.parse(r.expires_at) < Date.now() ? ' (expired)' : ''}` : 'Never') },
          { key: 'reason', label: 'Reason' },
          { key: 'created_at', label: 'Set', render: (r) => fmtDate(r.created_at) },
          { key: 'x', label: '', render: (r) => can('ADMIN') && <Button tone="ghost" onClick={() => run(async () => { await del(`/feature-overrides/${r.id}`); reload(); }, 'Override removed')}>Remove</Button> },
        ]} />
      </Card>
    </div>
  );
}
