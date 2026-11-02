import React, { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { get, post, put, del, qs } from '../api';
import { useApp } from '../App';
import { Alert, Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Table, Textarea, fmtAgo, fmtDate, useAction, useAsync } from '../components/ui';

const detailText = (d: any) => Object.entries(d || {}).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ');

export function EventsPage() {
  const { nav } = useApp();
  const [type, setType] = useState('');
  const { data, error } = useAsync(() => get(`/events${qs({ type })}`), [type]);
  const types = ['TRIAL_STARTED', 'ACTIVATED', 'DEACTIVATED', 'LICENSE_CREATED', 'TRIAL_EXTENDED', 'LICENSE_EXTENDED', 'LICENSE_RENEWED', 'TRIAL_CONVERTED',
    'PLAN_CHANGED', 'LICENSE_SUSPENDED', 'LICENSE_REACTIVATED', 'LICENSE_REVOKED', 'TRIAL_CANCELLED', 'INSTALLATION_SUSPENDED', 'INSTALLATION_DEACTIVATED',
    'APP_UPDATED', 'CREDENTIALS_ROTATED'];
  return (
    <div>
      <PageHeader title="License Activation History" subtitle="Activations, extensions, renewals, expirations and device changes"
        actions={<Select value={type} onChange={(e) => setType(e.target.value)} className="w-56"><option value="">All events</option>{types.map((t) => <option key={t}>{t}</option>)}</Select>} />
      <Alert>{error}</Alert>
      <Table rows={data?.data} onRow={(r) => r.license_id && nav('licenses', r.license_id)} columns={[
        { key: 'created_at', label: 'When', render: (r) => fmtDate(r.created_at, true) },
        { key: 'event_type', label: 'Event', render: (r) => <Badge value={r.event_type} /> },
        { key: 'customer_name', label: 'Customer' },
        { key: 'license_key', label: 'License', render: (r) => <span className="font-mono">{r.license_key || '—'}</span> },
        { key: 'actor', label: 'By', render: (r) => (r.actor === 'client' ? 'Desktop app' : r.actor === 'system' ? 'System' : 'Admin') },
        { key: 'details', label: 'Details', render: (r) => <span className="text-slate-500">{detailText(r.details)}</span> },
      ]} />
    </div>
  );
}

export function NoticesPage() {
  const { can } = useApp();
  const { data, error, reload } = useAsync(() => get('/notices'), []);
  const [form, setForm] = useState<any | null>(null);
  const { busy, msg, run } = useAction();
  const active = (n: any) => Date.parse(n.starts_at) <= Date.now() && (!n.ends_at || Date.parse(n.ends_at) > Date.now());
  return (
    <div>
      <PageHeader title="Notifications" subtitle="Administrative notices shown inside the desktop app at its next sync"
        actions={can('SUPPORT') && <Button tone="primary" onClick={() => setForm({ title: '', message: '', level: 'INFO', targetScope: 'ALL', targetId: '' })}><Plus className="w-3.5 h-3.5" />New notice</Button>} />
      <Alert>{error}</Alert>
      <Alert tone={msg?.tone}>{msg?.text}</Alert>
      <Table rows={data?.data} empty="No notices sent" columns={[
        { key: 'created_at', label: 'Created', render: (r) => fmtDate(r.created_at, true) },
        { key: 'level', label: 'Level', render: (r) => <Badge value={r.level} /> },
        { key: 'title', label: 'Title', render: (r) => <><div className="font-semibold">{r.title}</div><div className="text-[11px] text-slate-500">{r.message}</div></> },
        { key: 'target_scope', label: 'Audience', render: (r) => (r.target_scope === 'ALL' ? 'All installations' : `${r.target_scope.toLowerCase()} ${String(r.target_id).slice(0, 8)}…`) },
        { key: 'state', label: 'State', render: (r) => <Badge value={active(r) ? 'ACTIVE' : 'EXPIRED'} /> },
        { key: 'x', label: '', render: (r) => can('SUPPORT') && active(r) && <Button tone="ghost" onClick={() => run(async () => { await del(`/notices/${r.id}`); reload(); }, 'Notice ended')}>End</Button> },
      ]} />
      {form && (
        <Modal title="New notice" onClose={() => setForm(null)} footer={<Button tone="primary" busy={busy} onClick={() => run(async () => {
          await post('/notices', { ...form, targetId: form.targetScope === 'ALL' ? undefined : form.targetId, endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : undefined });
          setForm(null); reload();
        }, 'Notice published')}>Publish</Button>}>
          <Field label="Title"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Message"><Textarea rows={4} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Level"><Select value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })}>{['INFO', 'WARNING', 'CRITICAL', 'UPDATE'].map((l) => <option key={l}>{l}</option>)}</Select></Field>
            <Field label="Audience"><Select value={form.targetScope} onChange={(e) => setForm({ ...form, targetScope: e.target.value })}>
              <option value="ALL">All installations</option><option value="CUSTOMER">One customer</option><option value="LICENSE">One license</option><option value="INSTALLATION">One device</option></Select></Field>
          </div>
          {form.targetScope !== 'ALL' && <Field label={`${form.targetScope.toLowerCase()} ID`} hint="Copy the ID from the customer, license or installation page"><Input value={form.targetId} onChange={(e) => setForm({ ...form, targetId: e.target.value.trim() })} /></Field>}
          <Field label="Show until (optional)"><Input type="datetime-local" value={form.endsAt || ''} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} /></Field>
        </Modal>
      )}
    </div>
  );
}

export function AuditPage() {
  const [action, setAction] = useState('');
  const { data, error } = useAsync(() => get(`/audit-logs${qs({ action })}`), [action]);
  return (
    <div>
      <PageHeader title="Audit Logs" subtitle="Every administrative action, who did it and from where"
        actions={<Input placeholder="Filter by action, e.g. LICENSE_REVOKED" value={action} onChange={(e) => setAction(e.target.value.toUpperCase())} className="w-72" />} />
      <Alert>{error}</Alert>
      <Table rows={data?.data} columns={[
        { key: 'created_at', label: 'When', render: (r) => fmtDate(r.created_at, true) },
        { key: 'admin_email', label: 'Admin' },
        { key: 'action', label: 'Action', render: (r) => <Badge value={r.action} /> },
        { key: 'entity', label: 'Entity', render: (r) => `${r.entity_type}${r.entity_id ? ` ${String(r.entity_id).slice(0, 12)}` : ''}` },
        { key: 'details', label: 'Details', render: (r) => <span className="text-slate-500 break-all">{detailText(r.details)}</span> },
        { key: 'ip', label: 'IP' },
      ]} />
    </div>
  );
}

const SETTING_META: Array<{ key: string; label: string; hint: string; type?: 'bool' | 'number' }> = [
  { key: 'trial_days', label: 'Default trial length (days)', hint: 'Applied to new trials started from the desktop app', type: 'number' },
  { key: 'trials_enabled', label: 'Allow new trials', hint: 'Turn off to stop self-service trials', type: 'bool' },
  { key: 'trial_one_per_email', label: 'One trial per email', hint: '', type: 'bool' },
  { key: 'trial_one_per_device', label: 'One trial per computer', hint: 'Uses a hashed hardware hint — a soft signal only', type: 'bool' },
  { key: 'offline_grace_days', label: 'Offline grace period (days)', hint: 'How long an installation keeps full access without reaching this server', type: 'number' },
  { key: 'latest_version', label: 'Latest app version', hint: 'Installations on older versions see an update notification' },
  { key: 'min_supported_version', label: 'Minimum supported version', hint: 'Older versions see the update as mandatory' },
  { key: 'update_url', label: 'Download URL for updates', hint: 'Shown in the update notification' },
  { key: 'update_message', label: 'Update message', hint: '' },
];

export function SettingsPage() {
  const { can } = useApp();
  const { data, error } = useAsync(() => get('/settings'), [], { live: false });
  const [s, setS] = useState<Record<string, string>>({});
  const { busy, msg, run } = useAction();
  useEffect(() => { if (data) setS(data.settings); }, [data]);
  return (
    <div>
      <PageHeader title="System Settings" subtitle="Trials, offline policy and update notifications"
        actions={can('OWNER') && <Button tone="primary" busy={busy} onClick={() => run(async () => { setS((await put('/settings', s)).settings); }, 'Settings saved')}>Save</Button>} />
      <Alert>{error}</Alert>
      <Alert tone={msg?.tone}>{msg?.text}</Alert>
      <Card>
        <div className="grid md:grid-cols-2 gap-4">
          {SETTING_META.map((m) => (
            <Field key={m.key} label={m.label} hint={m.hint}>
              {m.type === 'bool'
                ? <Select disabled={!can('OWNER')} value={s[m.key] || '0'} onChange={(e) => setS({ ...s, [m.key]: e.target.value })}><option value="1">Yes</option><option value="0">No</option></Select>
                : <Input disabled={!can('OWNER')} type={m.type === 'number' ? 'number' : 'text'} value={s[m.key] || ''} onChange={(e) => setS({ ...s, [m.key]: e.target.value })} />}
            </Field>
          ))}
        </div>
      </Card>
    </div>
  );
}

export function AdminUsersPage() {
  const { admin } = useApp();
  const { data, error, reload } = useAsync(() => get('/admin-users'), []);
  const [form, setForm] = useState<any | null>(null);
  const { busy, msg, run } = useAction();
  return (
    <div>
      <PageHeader title="Admin Users" subtitle="OWNER: everything · ADMIN: licenses & features · SUPPORT: view, extend trials, notices · VIEWER: read-only"
        actions={<Button tone="primary" onClick={() => setForm({ email: '', name: '', role: 'SUPPORT', password: '' })}><Plus className="w-3.5 h-3.5" />Add admin</Button>} />
      <Alert>{error}</Alert>
      <Alert tone={msg?.tone}>{msg?.text}</Alert>
      <Table rows={data?.data} columns={[
        { key: 'name', label: 'Name', render: (r) => <><div className="font-semibold">{r.name}{r.id === admin.id && ' (you)'}</div><div className="text-[10px] text-slate-400">{r.email}</div></> },
        { key: 'role', label: 'Role', render: (r) => (
          <Select disabled={r.id === admin.id} value={r.role} className="!py-0.5 w-28" onChange={(e) => run(async () => { await put(`/admin-users/${r.id}`, { role: e.target.value }); reload(); }, 'Role updated')}>
            {['OWNER', 'ADMIN', 'SUPPORT', 'VIEWER'].map((x) => <option key={x}>{x}</option>)}</Select>) },
        { key: 'status', label: 'Status', render: (r) => <Badge value={r.status} /> },
        { key: 'totp_enabled', label: '2FA', render: (r) => <Badge value={r.totp_enabled ? 'ON' : 'OFF'} /> },
        { key: 'last_login_at', label: 'Last login', render: (r) => fmtAgo(r.last_login_at) },
        { key: 'x', label: '', render: (r) => r.id !== admin.id && (
          <Button tone="ghost" onClick={() => run(async () => { await put(`/admin-users/${r.id}`, { status: r.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' }); reload(); }, 'Updated')}>
            {r.status === 'ACTIVE' ? 'Disable' : 'Enable'}</Button>) },
      ]} />
      {form && (
        <Modal title="Add admin" onClose={() => setForm(null)} footer={<Button tone="primary" busy={busy} onClick={() => run(async () => { await post('/admin-users', form); setForm(null); reload(); }, 'Admin added')}>Create</Button>}>
          <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Role"><Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{['OWNER', 'ADMIN', 'SUPPORT', 'VIEWER'].map((x) => <option key={x}>{x}</option>)}</Select></Field>
          <Field label="Temporary password" hint="At least 10 characters; ask them to change it after first login"><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
        </Modal>
      )}
    </div>
  );
}

export function SecurityPage() {
  const me = useAsync(() => get('/auth/me'), []);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const { busy, msg, run } = useAction();
  const enabled = me.data?.admin.totpEnabled;
  return (
    <div className="space-y-4 max-w-2xl">
      <PageHeader title="My Security" subtitle="Password and two-factor authentication" />
      <Alert tone={msg?.tone}>{msg?.text}</Alert>
      <Card title="Change password">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Current password"><Input type="password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></Field>
          <Field label="New password" hint="At least 10 characters"><Input type="password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /></Field>
        </div>
        <Button tone="primary" className="mt-3" busy={busy} onClick={() => run(async () => { await post('/auth/change-password', pw); setPw({ currentPassword: '', newPassword: '' }); }, 'Password changed. Other sessions were signed out.')}>Change password</Button>
      </Card>
      <Card title={<span className="inline-flex items-center gap-2">Two-factor authentication <Badge value={enabled ? 'ON' : 'OFF'} /></span>}>
        {!enabled && !setup && <Button tone="primary" onClick={() => run(async () => setSetup(await post('/auth/totp/setup')))}>Set up authenticator app</Button>}
        {setup && !enabled && (
          <div className="space-y-2 text-xs">
            <p>Add this key to Google Authenticator, Microsoft Authenticator or similar (choose “enter a setup key”, time-based):</p>
            <div className="font-mono text-sm bg-slate-100 dark:bg-slate-950 rounded px-2 py-1 break-all select-all text-slate-800 dark:text-slate-100">{setup.secret}</div>
            <Field label="Enter the 6-digit code to confirm"><Input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className="w-32" /></Field>
            <Button tone="primary" busy={busy} onClick={() => run(async () => { await post('/auth/totp/enable', { code }); setSetup(null); setCode(''); me.reload(); }, 'Two-factor authentication enabled')}>Enable</Button>
          </div>
        )}
        {enabled && (
          <div className="flex items-end gap-2">
            <Field label="Code to disable"><Input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className="w-32" /></Field>
            <Button tone="danger" busy={busy} onClick={() => run(async () => { await post('/auth/totp/disable', { code }); setCode(''); me.reload(); }, 'Two-factor authentication disabled')}>Disable 2FA</Button>
          </div>
        )}
      </Card>
    </div>
  );
}
