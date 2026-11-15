import React, { useEffect, useState } from 'react';
import { ArrowLeft, Copy, Plus, Trash2 } from 'lucide-react';
import { del, get, post, put, qs } from '../api';
import { useApp } from '../App';
import { Alert, Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Table, Textarea, daysLeft, fmtAgo, fmtDate, fmtINR, useAction, useAsync } from '../components/ui';
import { DeleteDeviceButton, deviceStatusCell } from '../components/DeviceControls';
import { FeatureMatrix } from '../components/FeatureMatrix';
import { promptDialog } from '../components/dialogs';

export const licenseStatusCell = (r: any) => {
  const s = r.effective_status || r.status;
  const d = daysLeft(r.expires_at);
  return <span className="inline-flex items-center gap-1"><Badge value={s} />{s === 'ACTIVE' && d !== null && d <= 7 && <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">{d}d left</span>}</span>;
};

/** Revoked / expired / unused (no live devices) can be removed from history. */
export function canDeleteLicense(l: any) {
  const s = l.effective_status || l.status;
  if (s === 'REVOKED' || s === 'EXPIRED') return true;
  const devices = Number(l.device_count ?? l.live_devices ?? 0);
  if (Array.isArray(l.installations)) {
    return !l.installations.some((i: any) => i.status === 'ACTIVE');
  }
  return devices === 0;
}

export function CreateLicenseModal({ customerId, onClose, onCreated }: { customerId?: string; onClose: () => void; onCreated: (l: any) => void }) {
  const plans = useAsync(() => get('/plans'), []);
  const customers = useAsync(() => (customerId ? Promise.resolve({ data: [] }) : get('/customers')), [customerId]);
  const [f, setF] = useState({ customerId: customerId || '', planCode: 'YEAR_1', durationDays: '', maxDevices: '', paymentAmount: '', paymentReference: '', paymentMethod: 'UPI', notes: '' });
  const { busy, msg, run } = useAction();
  const plan = plans.data?.data.find((p: any) => p.code === f.planCode);
  const save = () => run(async () => {
    const r = await post('/licenses', {
      customerId: f.customerId, planCode: f.planCode,
      durationDays: f.durationDays ? Number(f.durationDays) : undefined,
      maxDevices: f.maxDevices ? Number(f.maxDevices) : undefined,
      paymentAmountPaise: f.paymentAmount ? Math.round(Number(f.paymentAmount) * 100) : undefined,
      paymentReference: f.paymentReference || undefined, paymentMethod: f.paymentAmount ? f.paymentMethod : undefined, notes: f.notes || undefined,
    });
    onCreated(r.license);
  });
  return (
    <Modal title="Issue license" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button tone="primary" busy={busy} onClick={save}>Create license</Button></>}>
      <Alert tone={msg?.tone}>{msg?.text}</Alert>
      {!customerId && (
        <Field label="Customer *">
          <Select value={f.customerId} onChange={(e) => setF({ ...f, customerId: e.target.value })}>
            <option value="">Select customer…</option>
            {customers.data?.data.map((c: any) => <option key={c.id} value={c.id}>{c.business_name || c.name} ({c.email || c.phone || c.id.slice(0, 8)})</option>)}
          </Select>
        </Field>
      )}
      <Field label="Plan">
        <Select value={f.planCode} onChange={(e) => setF({ ...f, planCode: e.target.value })}>
          {plans.data?.data.filter((p: any) => p.is_active).map((p: any) => <option key={p.id} value={p.code}>{p.name} — {p.duration_days ? `${p.duration_days} days` : 'lifetime'}</option>)}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Custom duration (days)" hint={`Default ${plan?.duration_days ?? '∞'}`}><Input type="number" min={1} value={f.durationDays} onChange={(e) => setF({ ...f, durationDays: e.target.value })} /></Field>
        <Field label="Device limit" hint={`Plan default ${plan?.max_devices ?? 1}`}><Input type="number" min={1} value={f.maxDevices} onChange={(e) => setF({ ...f, maxDevices: e.target.value })} /></Field>
        <Field label="Amount paid (₹)"><Input type="number" min={0} step="0.01" value={f.paymentAmount} onChange={(e) => setF({ ...f, paymentAmount: e.target.value })} /></Field>
        <Field label="Payment method"><Select value={f.paymentMethod} onChange={(e) => setF({ ...f, paymentMethod: e.target.value })}>{['UPI', 'BANK_TRANSFER', 'CASH', 'CARD', 'CHEQUE', 'OTHER'].map((m) => <option key={m}>{m}</option>)}</Select></Field>
      </div>
      <Field label="Payment reference"><Input value={f.paymentReference} onChange={(e) => setF({ ...f, paymentReference: e.target.value })} /></Field>
      <Field label="Notes"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
    </Modal>
  );
}

const PRESETS: Record<string, { title: string; subtitle: string; query: Record<string, string> }> = {
  all: { title: 'Licenses', subtitle: 'All licenses', query: {} },
  trials: { title: 'Trial Licenses', subtitle: 'Free trials started from the desktop app', query: { type: 'TRIAL' } },
  paid: { title: 'Paid Licenses', subtitle: 'Licenses you have sold', query: { type: 'PAID' } },
  suspended: { title: 'Suspended Accounts', subtitle: 'Temporarily blocked — customers keep read-only access to their data', query: { status: 'SUSPENDED' } },
  expired: { title: 'Expired Licenses', subtitle: 'Past their end date — renew or convert', query: { status: 'EXPIRED' } },
};

/** Where the licence's computers stand: in use, signed out, uninstalled */
function DeviceCounts({ installations }: { installations: any[] }) {
  const uninstalled = installations.filter((i) => i.uninstalled_at).length;
  const signedOut = installations.filter((i) => i.status === 'DEACTIVATED' && !i.uninstalled_at).length;
  const inUse = installations.length - uninstalled - signedOut;
  return (
    <div className="text-slate-500 dark:text-slate-400">
      Installed and in use now: <b className="text-slate-800 dark:text-slate-100">{inUse}</b>
      {signedOut > 0 && <> · signed out {signedOut}</>}
      {uninstalled > 0 && <> · uninstalled {uninstalled}</>}
    </div>
  );
}

export function LicensesPage({ preset }: { preset: keyof typeof PRESETS }) {
  const { nav, can } = useApp();
  const p = PRESETS[preset];
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const { data, error, reload } = useAsync(() => get(`/licenses${qs({ ...p.query, status: p.query.status || status, search })}`), [preset, search, status]);
  const { busy, msg, run } = useAction();

  const deleteLicense = async (r: any, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!canDeleteLicense(r)) return;
    const reason = await promptDialog(`Permanently delete ${r.license_key}? Installations and history for this key are removed. Audit log keeps a record.`, {
      title: 'Delete license from history?',
      label: 'Reason (optional)',
      placeholder: 'Why remove this license?',
      danger: true,
      confirmText: 'Delete',
    });
    if (reason === null) return;
    await run(async () => {
      await del(`/licenses/${r.id}`, { reason: reason || undefined });
      reload();
    }, `Deleted ${r.license_key}`);
  };

  return (
    <div>
      <PageHeader title={p.title} subtitle={p.subtitle} actions={<>
        <Input placeholder="Search key, customer…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-56" />
        {!p.query.status && (
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-36">
            <option value="">Any status</option>{['ACTIVE', 'EXPIRED', 'SUSPENDED', 'REVOKED'].map((s) => <option key={s}>{s}</option>)}
          </Select>
        )}
        {can('ADMIN') && preset !== 'trials' && <Button tone="primary" onClick={() => setCreating(true)}><Plus className="w-3.5 h-3.5" />Issue license</Button>}
      </>} />
      <Alert>{error}</Alert>
      <Alert tone={msg?.tone}>{msg?.text}</Alert>
      <Table rows={data?.data} onRow={(r) => nav('licenses', r.id)} columns={[
        { key: 'license_key', label: 'License', render: (r) => <span className="font-mono">{r.license_key}</span> },
        { key: 'customer_name', label: 'Customer', render: (r) => <><div className="font-semibold">{r.business_name || r.customer_name}</div><div className="text-[10px] text-slate-400">{r.customer_email}</div></> },
        { key: 'type', label: 'Type', render: (r) => <Badge value={r.type} /> },
        { key: 'plan_name', label: 'Plan' },
        { key: 'status', label: 'Status', render: licenseStatusCell },
        { key: 'devices', label: 'Devices', render: (r) => `${r.device_count} / ${r.max_devices}` },
        { key: 'starts_at', label: 'Start', render: (r) => fmtDate(r.starts_at) },
        { key: 'expires_at', label: 'Expires', render: (r) => (r.expires_at ? fmtDate(r.expires_at) : 'Lifetime') },
        { key: 'payment', label: 'Paid', render: (r) => fmtINR(r.payment_amount_paise) },
        ...(can('ADMIN') ? [{
          key: 'actions',
          label: 'Action',
          className: 'w-16 text-right',
          render: (r: any) => canDeleteLicense(r) ? (
            <button
              type="button"
              disabled={busy}
              title="Delete from history"
              onClick={(e) => { void deleteLicense(r, e); }}
              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition disabled:opacity-40"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          ) : <span className="text-[10px] text-slate-300">—</span>,
        }] : []),
      ]} />
      {creating && <CreateLicenseModal onClose={() => setCreating(false)} onCreated={(l) => { setCreating(false); nav('licenses', l.id); }} />}
    </div>
  );
}

/** The licence list a licence appears in, as in the menu */
const listOf = (l: any) => (l.status === 'SUSPENDED' ? 'suspended' : l.status === 'EXPIRED' ? 'expired' : l.type === 'TRIAL' ? 'trials' : 'paid');

export function LicenseDetail({ id }: { id: string }) {
  const { nav, can, setLicenseList } = useApp();
  const { data, error, reload } = useAsync(() => get(`/licenses/${id}`), [id]);
  useEffect(() => { if (data?.license) setLicenseList(id, listOf(data.license)); }, [id, data?.license]);
  const plans = useAsync(() => get('/plans'), []);
  const { busy, msg, run } = useAction();
  const [dialog, setDialog] = useState<null | 'extend' | 'renew' | 'convert' | 'plan' | 'edit'>(null);
  const [form, setForm] = useState<any>({});
  const l = data?.license;
  const act = (path: string, body: object, ok: string) => run(async () => { await post(`/licenses/${id}/${path}`, body); setDialog(null); reload(); }, ok);
  const confirmAct = async (path: string, label: string) => {
    const reason = await promptDialog('This takes effect when the customer\'s installations next connect.', {
      title: `${label}?`, label: 'Reason (recorded in audit log)', placeholder: 'Optional', danger: true, confirmText: label,
    });
    if (reason !== null) act(path, { reason }, `${label} done. Applied when installations next connect.`);
  };
  const paidPlans = (plans.data?.data || []).filter((p: any) => !p.is_trial && p.is_active);
  // Computers that still use this licence (installed and not signed out)
  const inUse = (data?.installations || []).filter((i: any) => i.status !== 'DEACTIVATED' && !i.uninstalled_at).length;
  const resetActivations = async () => {
    const value = await promptDialog(
      `${inUse} computer${inUse === 1 ? '' : 's'} use this licence right now. Set "Activations used" to that (or another number) so computers that were uninstalled, deleted or signed out no longer count.`,
      { title: 'Reset activations used', label: 'Activations used', defaultValue: String(inUse), required: true, confirmText: 'Reset' },
    );
    if (value === null) return;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0) return void run(async () => { throw new Error('Enter a whole number (0 or more).'); });
    run(async () => { await put(`/licenses/${id}`, { activationsCount: n }); reload(); }, `Activations used set to ${n}.`);
  };
  const fitDeviceLimit = async () => {
    const value = await promptDialog(
      `${inUse} computer${inUse === 1 ? '' : 's'} use this licence right now. How many computers may use it at the same time?`,
      { title: 'Device limit', label: 'Device limit', defaultValue: String(Math.max(1, inUse)), required: true, confirmText: 'Save' },
    );
    if (value === null) return;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1) return void run(async () => { throw new Error('The device limit is at least 1.'); });
    run(async () => { await put(`/licenses/${id}`, { maxDevices: n }); reload(); }, `Device limit set to ${n}.`);
  };

  return (
    <div className="space-y-4">
      <Button tone="ghost" onClick={() => nav(l ? listOf(l) : 'paid')}><ArrowLeft className="w-3.5 h-3.5" />Licenses</Button>
      <Alert>{error}</Alert>
      <Alert tone={msg?.tone}>{msg?.text}</Alert>
      {l && (
        <>
          <PageHeader title={data.customer.business_name || data.customer.name}
            subtitle={`${data.plan.name} · ${l.type} · license ID ${l.id}`}
            actions={<>
              {l.type === 'TRIAL' && can('SUPPORT') && <Button onClick={() => { setForm({ days: 7 }); setDialog('extend'); }}>Extend trial</Button>}
              {l.type === 'TRIAL' && can('ADMIN') && <Button tone="primary" onClick={() => { setForm({ planCode: 'YEAR_1' }); setDialog('convert'); }}>Convert to paid</Button>}
              {l.type === 'TRIAL' && can('SUPPORT') && l.status !== 'REVOKED' && <Button onClick={() => confirmAct('cancel-trial', 'Cancel trial')}>Cancel trial</Button>}
              {l.type === 'PAID' && can('ADMIN') && <Button tone="primary" onClick={() => { setForm({ planCode: data.plan.code }); setDialog('renew'); }}>Renew</Button>}
              {l.type === 'PAID' && can('ADMIN') && l.expires_at && <Button onClick={() => { setForm({ days: 30 }); setDialog('extend'); }}>Extend</Button>}
              {can('ADMIN') && <Button onClick={() => { setForm({ planCode: data.plan.code, resetExpiry: false }); setDialog('plan'); }}>Change plan</Button>}
              {can('ADMIN') && <Button onClick={() => { setForm({ maxDevices: l.max_devices, maxActivations: l.max_activations ?? '', activationsCount: l.activations_count ?? 0, notes: l.notes || '', paymentReference: l.payment_reference || '' }); setDialog('edit'); }}>Edit limits</Button>}
              {can('ADMIN') && l.status === 'ACTIVE' && <Button tone="warning" onClick={() => confirmAct('suspend', 'Suspend license')}>Suspend</Button>}
              {can('ADMIN') && l.status === 'SUSPENDED' && <Button tone="primary" onClick={() => act('reactivate', {}, 'License reactivated')}>Reactivate</Button>}
              {can('ADMIN') && l.status !== 'REVOKED' && <Button tone="danger" onClick={() => confirmAct('revoke', 'Revoke license permanently')}>Revoke</Button>}
              {can('ADMIN') && canDeleteLicense({ ...l, installations: data.installations }) && (
                <Button tone="danger" busy={busy} onClick={async () => {
                  const reason = await promptDialog(`Permanently delete ${l.license_key}? This removes the key and its installations from the license server.`, {
                    title: 'Delete license from history?', label: 'Reason (optional)', placeholder: 'Why remove this license?', danger: true, confirmText: 'Delete',
                  });
                  if (reason === null) return;
                  await run(async () => {
                    await del(`/licenses/${id}`, { reason: reason || undefined });
                    nav(l.type === 'TRIAL' ? 'trials' : 'paid');
                  }, 'License deleted');
                }}><Trash2 className="w-3.5 h-3.5" />Delete</Button>
              )}
            </>} />
          <div className="grid md:grid-cols-4 gap-3">
            <Card title="License key">
              <div className="flex items-center gap-2"><span className="font-mono text-sm font-bold">{l.license_key}</span>
                <button className="text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-300" title="Copy" onClick={() => navigator.clipboard?.writeText(l.license_key)}><Copy className="w-3.5 h-3.5" /></button></div>
              <div className="mt-2">{licenseStatusCell(l)}</div>
            </Card>
            <Card title="Validity">
              <div className="text-xs space-y-1"><div>Start: <b>{fmtDate(l.starts_at)}</b></div><div>Expires: <b>{l.expires_at ? fmtDate(l.expires_at) : 'Lifetime'}</b></div>
                {l.expires_at && <div>{daysLeft(l.expires_at)! >= 0 ? `${daysLeft(l.expires_at)} days remaining` : `expired ${-daysLeft(l.expires_at)!} days ago`}</div>}</div>
            </Card>
            <Card title="Devices">
              <div className="text-xs space-y-1"><div>Active: <b>{data.installations.filter((i: any) => i.status !== 'DEACTIVATED').length} / {l.max_devices}</b></div>
                <div>Activations used: <b>{l.activations_count}{l.max_activations ? ` / ${l.max_activations}` : ''}</b></div>
                <DeviceCounts installations={data.installations} />
                {can('ADMIN') && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <Button disabled={busy} onClick={() => void resetActivations()}>Reset activations</Button>
                    <Button disabled={busy} onClick={() => void fitDeviceLimit()}>Set device limit</Button>
                  </div>
                )}
                {data.installations.filter((i: any) => i.status !== 'DEACTIVATED').length > l.max_devices && (
                  <div className="mt-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                    More devices are active than the limit allows. Deactivate or delete one below, or raise the limit (Edit limits).
                  </div>
                )}
                {l.max_activations != null && l.activations_count >= l.max_activations && (
                  <div className="mt-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                    All activations are used: a new computer (or a reinstall) cannot activate until you raise "Max activations" (Edit limits).
                  </div>
                )}</div>
            </Card>
            <Card title="Payment">
              <div className="text-xs space-y-1"><div>Amount: <b>{fmtINR(l.payment_amount_paise)}</b></div><div>Method: {l.payment_method || '—'}</div>
                <div>Ref: {l.payment_reference || '—'}</div><div>Paid: {fmtDate(l.paid_at)}</div></div>
            </Card>
          </div>
          <Card title="Installations on this license">
            <Table rows={data.installations} empty="Not activated on any device yet" onRow={(r) => nav('installations', r.id)} columns={[
              { key: 'device_name', label: 'Device' }, { key: 'os', label: 'OS' }, { key: 'app_version', label: 'Version' },
              { key: 'status', label: 'Status', render: deviceStatusCell },
              { key: 'activated_at', label: 'Activated', render: (r) => fmtDate(r.activated_at) },
              { key: 'last_verified_at', label: 'Last verified', render: (r) => fmtAgo(r.last_verified_at) },
              { key: 'delete', label: '', render: (r) => <DeleteDeviceButton device={r} onDeleted={reload} /> },
            ]} />
          </Card>
          <Card title="Features for this license">
            <FeatureMatrix scope="LICENSE" scopeId={id} resolved={data.features} overrides={data.overrides} onChanged={reload} />
          </Card>
          <Card title="Activation & expiration history">
            <Table rows={data.events} columns={[
              { key: 'created_at', label: 'When', render: (r) => fmtDate(r.created_at, true) },
              { key: 'event_type', label: 'Event', render: (r) => <Badge value={r.event_type} /> },
              { key: 'actor', label: 'By', render: (r) => (r.actor === 'client' ? 'Desktop app' : 'Admin') },
              { key: 'details', label: 'Details', render: (r) => <span className="text-slate-500">{Object.entries(r.details || {}).filter(([, v]) => v != null).map(([k, v]) => `${k}: ${v}`).join(' · ')}</span> },
            ]} />
          </Card>
        </>
      )}

      {dialog === 'extend' && (
        <Modal title="Extend" onClose={() => setDialog(null)} footer={<Button tone="primary" busy={busy} onClick={() => act('extend', { days: Number(form.days), reason: form.reason }, 'Extended')}>Extend</Button>}>
          <Field label="Add days" hint="Added to the current expiry (or today, if already expired)"><Input type="number" min={1} value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} /></Field>
          <Field label="Reason"><Input value={form.reason || ''} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
        </Modal>
      )}
      {(dialog === 'renew' || dialog === 'convert') && (
        <Modal title={dialog === 'renew' ? 'Renew license' : 'Convert trial to paid'} onClose={() => setDialog(null)}
          footer={<Button tone="primary" busy={busy} onClick={() => act(dialog, { planCode: form.planCode, paymentReference: form.paymentReference || undefined,
            paymentAmountPaise: form.amount ? Math.round(Number(form.amount) * 100) : undefined, paymentMethod: form.method || undefined }, dialog === 'renew' ? 'Renewed' : 'Converted to paid')}>Confirm</Button>}>
          <Field label="Plan"><Select value={form.planCode} onChange={(e) => setForm({ ...form, planCode: e.target.value })}>
            {paidPlans.map((p: any) => <option key={p.id} value={p.code}>{p.name}</option>)}</Select></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount (₹)"><Input type="number" value={form.amount || ''} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
            <Field label="Reference"><Input value={form.paymentReference || ''} onChange={(e) => setForm({ ...form, paymentReference: e.target.value })} /></Field>
          </div>
          {dialog === 'renew' && <p className="text-[11px] text-slate-500">Renewal adds the plan's duration to the current expiry date (or today, if expired).</p>}
        </Modal>
      )}
      {dialog === 'plan' && (
        <Modal title="Change plan" onClose={() => setDialog(null)} footer={<Button tone="primary" busy={busy} onClick={() => act('change-plan', { planCode: form.planCode, resetExpiry: !!form.resetExpiry }, 'Plan changed')}>Change plan</Button>}>
          <Field label="Plan"><Select value={form.planCode} onChange={(e) => setForm({ ...form, planCode: e.target.value })}>
            {(plans.data?.data || []).map((p: any) => <option key={p.id} value={p.code}>{p.name}</option>)}</Select></Field>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!form.resetExpiry} onChange={(e) => setForm({ ...form, resetExpiry: e.target.checked })} />Restart the term from today using the new plan's duration</label>
        </Modal>
      )}
      {dialog === 'edit' && (
        <Modal title="Limits & notes" onClose={() => setDialog(null)} footer={<Button tone="primary" busy={busy} onClick={() => run(async () => {
          const used = Number(form.activationsCount);
          if (!Number.isInteger(used) || used < 0) throw new Error('Activations used must be a whole number (0 or more).');
          await put(`/licenses/${id}`, { maxDevices: Number(form.maxDevices), maxActivations: form.maxActivations === '' ? null : Number(form.maxActivations),
            activationsCount: used, notes: form.notes || null, paymentReference: form.paymentReference || null });
          setDialog(null); reload();
        }, 'Saved')}>Save</Button>}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Device limit"><Input type="number" min={1} value={form.maxDevices} onChange={(e) => setForm({ ...form, maxDevices: e.target.value })} /></Field>
            <Field label="Activation limit" hint="Blank = unlimited"><Input type="number" min={1} value={form.maxActivations} onChange={(e) => setForm({ ...form, maxActivations: e.target.value })} /></Field>
            <Field label="Activations used" hint={`Computers in use now: ${inUse}. Lower it after an uninstall or a deleted device.`}>
              <Input type="number" min={0} value={form.activationsCount} onChange={(e) => setForm({ ...form, activationsCount: e.target.value })} />
            </Field>
          </div>
          <Field label="Payment reference"><Input value={form.paymentReference} onChange={(e) => setForm({ ...form, paymentReference: e.target.value })} /></Field>
          <Field label="Notes"><Textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        </Modal>
      )}
    </div>
  );
}
