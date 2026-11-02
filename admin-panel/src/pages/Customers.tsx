import React, { useState } from 'react';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { del, get, post, put, qs } from '../api';
import { useApp } from '../App';
import { Alert, Badge, Button, Card, Field, Input, Modal, PageHeader, Table, Textarea, fmtAgo, fmtDate, useAction, useAsync } from '../components/ui';
import { FeatureMatrix } from '../components/FeatureMatrix';
import { CreateLicenseModal, licenseStatusCell } from './Licenses';

function CustomerForm({ initial, onSaved, onClose }: { initial?: any; onSaved: (c: any) => void; onClose: () => void }) {
  const [f, setF] = useState({ name: initial?.name || '', businessName: initial?.business_name || '', email: initial?.email || '', phone: initial?.phone || '', notes: initial?.notes || '' });
  const { busy, msg, run } = useAction();
  const save = () => run(async () => {
    const r = initial ? await put(`/customers/${initial.id}`, f) : await post('/customers', f);
    onSaved(r.customer);
  });
  return (
    <Modal title={initial ? 'Edit customer' : 'New customer'} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button tone="primary" busy={busy} onClick={save}>Save</Button></>}>
      <Alert tone={msg?.tone}>{msg?.text}</Alert>
      <Field label="Contact name *"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="Business name"><Input value={f.businessName} onChange={(e) => setF({ ...f, businessName: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Phone"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
      </div>
      <Field label="Notes"><Textarea rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
    </Modal>
  );
}

function DeleteCustomerModal({ data, onClose, onDeleted }: { data: any; onClose: () => void; onDeleted: () => void }) {
  const c = data.customer;
  const expected = String(c.business_name || c.name).trim();
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');
  const { busy, msg, run } = useAction();
  const matches = typed.trim().toLowerCase() === expected.toLowerCase();
  const remove = () => run(async () => {
    await del(`/customers/${c.id}`, { confirmName: typed, reason: reason || undefined });
    onDeleted();
  });
  return (
    <Modal title="Delete customer permanently" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button tone="danger" busy={busy} disabled={!matches} onClick={remove}><Trash2 className="w-3.5 h-3.5" />Delete permanently</Button></>}>
      <Alert tone={msg?.tone}>{msg?.text}</Alert>
      <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
        This removes <b>{expected}</b> and everything linked to them from the license server: {data.licenses?.length || 0} license(s),{' '}
        {data.installations?.length || 0} installation(s), usage history and feature permissions. It cannot be undone. The audit log keeps a record.
      </p>
      <ul className="text-[11px] text-slate-500 list-disc pl-4 space-y-0.5">
        <li>Devices that can still use a license block the delete — revoke/suspend the license or deactivate those devices first.</li>
        <li>The customer's own billing data on their computer is not touched.</li>
        <li>Their email and computer will be able to start a new free trial again.</li>
      </ul>
      <Field label={`Type "${expected}" to confirm`}><Input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus /></Field>
      <Field label="Reason (recorded in audit log)"><Input value={reason} placeholder="Optional" onChange={(e) => setReason(e.target.value)} /></Field>
    </Modal>
  );
}

export function CustomersPage() {
  const { nav, can } = useApp();
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const { data, error } = useAsync(() => get(`/customers${qs({ search })}`), [search]);
  return (
    <div>
      <PageHeader title="Customers" subtitle="Everyone who has a trial or license"
        actions={<>
          <Input placeholder="Search name, email, phone…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-64" />
          {can('ADMIN') && <Button tone="primary" onClick={() => setCreating(true)}><Plus className="w-3.5 h-3.5" />New customer</Button>}
        </>} />
      <Alert>{error}</Alert>
      <Table rows={data?.data} onRow={(r) => nav('customers', r.id)} columns={[
        { key: 'name', label: 'Customer', render: (r) => <><div className="font-semibold">{r.business_name || r.name}</div><div className="text-[10px] text-slate-400">{r.name}</div></> },
        { key: 'email', label: 'Email' },
        { key: 'phone', label: 'Phone' },
        { key: 'license_count', label: 'Licenses' },
        { key: 'installation_count', label: 'Devices' },
        { key: 'last_seen_at', label: 'Last seen', render: (r) => fmtAgo(r.last_seen_at) },
        { key: 'status', label: 'Status', render: (r) => <Badge value={r.status} /> },
        { key: 'created_at', label: 'Since', render: (r) => fmtDate(r.created_at) },
      ]} />
      {creating && <CustomerForm onClose={() => setCreating(false)} onSaved={(c) => { setCreating(false); nav('customers', c.id); }} />}
    </div>
  );
}

export function CustomerDetail({ id }: { id: string }) {
  const { nav, can } = useApp();
  const { data, error, reload } = useAsync(() => get(`/customers/${id}`), [id]);
  const overrides = useAsync(() => get(`/feature-overrides${qs({ scope: 'CUSTOMER', scopeId: id })}`), [id]);
  const [editing, setEditing] = useState(false);
  const [newLicense, setNewLicense] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const c = data?.customer;
  return (
    <div className="space-y-4">
      <Button tone="ghost" onClick={() => nav('customers')}><ArrowLeft className="w-3.5 h-3.5" />Customers</Button>
      <Alert>{error}</Alert>
      {c && (
        <PageHeader title={c.business_name || c.name} subtitle={`${c.name} · ${c.email || 'no email'} · ${c.phone || 'no phone'} · ID ${c.id}`}
          actions={can('ADMIN') && <>
            {can('OWNER') && <Button tone="danger" onClick={() => setDeleting(true)}><Trash2 className="w-3.5 h-3.5" />Delete</Button>}
            <Button onClick={() => setEditing(true)}>Edit</Button>
            <Button tone="primary" onClick={() => setNewLicense(true)}><Plus className="w-3.5 h-3.5" />Issue license</Button>
          </>} />
      )}
      {c?.notes && <Card title="Notes"><p className="text-xs whitespace-pre-wrap text-slate-600 dark:text-slate-300">{c.notes}</p></Card>}
      <Card title="Licenses">
        <Table rows={data?.licenses} empty="No licenses" onRow={(r) => nav('licenses', r.id)} columns={[
          { key: 'license_key', label: 'Key', render: (r) => <span className="font-mono">{r.license_key}</span> },
          { key: 'type', label: 'Type', render: (r) => <Badge value={r.type} /> },
          { key: 'plan_name', label: 'Plan' },
          { key: 'status', label: 'Status', render: licenseStatusCell },
          { key: 'expires_at', label: 'Expires', render: (r) => (r.expires_at ? fmtDate(r.expires_at) : 'Lifetime') },
          { key: 'max_devices', label: 'Device limit' },
        ]} />
      </Card>
      <Card title="Installations">
        <Table rows={data?.installations} empty="Not installed anywhere yet" onRow={(r) => nav('installations', r.id)} columns={[
          { key: 'device_name', label: 'Device' }, { key: 'os', label: 'OS' }, { key: 'app_version', label: 'Version' },
          { key: 'status', label: 'Status', render: (r) => <Badge value={r.status} /> },
          { key: 'last_seen_at', label: 'Last seen', render: (r) => fmtAgo(r.last_seen_at) },
        ]} />
      </Card>
      <Card title="Feature usage (all devices)">
        <Table rows={data?.usage} empty="No usage reported yet" columns={[
          { key: 'feature_key', label: 'Feature' }, { key: 'count', label: 'Operations', render: (r) => r.count.toLocaleString('en-IN') },
          { key: 'first_used', label: 'First used', render: (r) => fmtDate(r.first_used) }, { key: 'last_used', label: 'Last used', render: (r) => fmtAgo(r.last_used) },
        ]} />
      </Card>
      <Card title="Customer-specific feature permissions (apply to all of this customer's licenses)">
        <FeatureMatrix scope="CUSTOMER" scopeId={id} overrides={overrides.data?.data || []} onChanged={overrides.reload} />
      </Card>
      {editing && c && <CustomerForm initial={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
      {deleting && data && <DeleteCustomerModal data={data} onClose={() => setDeleting(false)} onDeleted={() => { setDeleting(false); nav('customers'); }} />}
      {newLicense && c && <CreateLicenseModal customerId={c.id} onClose={() => setNewLicense(false)} onCreated={(l) => { setNewLicense(false); nav('licenses', l.id); }} />}
    </div>
  );
}
