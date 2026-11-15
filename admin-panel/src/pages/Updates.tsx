import React, { useRef, useState } from 'react';
import { CheckCircle2, CloudUpload, FileCheck2, PauseCircle, PlayCircle, Rocket, ShieldAlert, Trash2 } from 'lucide-react';
import { get, post, session } from '../api';
import { useApp } from '../App';
import { Alert, Badge, Button, Card, Field, Input, Modal, PageHeader, Table, Textarea, cx, fmtDate, useAction, useAsync } from '../components/ui';

type Confirm = { title: string; body: React.ReactNode; action: string; danger?: boolean; run: (password: string, totp?: string) => Promise<unknown> };

/** Re-enter the Admin Panel password (and 2FA code) before anything reaches clients. */
function ConfirmPassword({ c, onClose, onDone }: { c: Confirm; onClose: () => void; onDone: (msg: string) => void }) {
  const { admin } = useApp();
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const { busy, msg, run } = useAction();
  const go = () => run(async () => { await c.run(password, admin.totpEnabled ? totp : undefined); onDone(`${c.action}: done`); });
  return (
    <Modal title={c.title} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button tone={c.danger ? 'danger' : 'primary'} busy={busy} disabled={!password} onClick={go}>{c.action}</Button></>}>
      <div className="text-xs text-slate-600 dark:text-slate-300 space-y-2">{c.body}</div>
      <Alert tone={msg?.tone}>{msg?.text}</Alert>
      <Field label="Your Admin Panel password">
        <Input type="password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && password) void go(); }} />
      </Field>
      {admin.totpEnabled && (
        <Field label="Authenticator code"><Input inputMode="numeric" maxLength={6} value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))} /></Field>
      )}
    </Modal>
  );
}

/** Upload with progress (the installer is tens of MB). Raw body; version and signature travel in headers. */
function uploadInstaller(file: File, version: string, signature: string, onProgress: (pct: number) => void): Promise<any> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/admin/v1/app-updates/upload');
    xhr.setRequestHeader('Authorization', `Bearer ${session.get() || ''}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-Release-Version', version);
    xhr.setRequestHeader('X-Release-Signature', signature);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      let data: any = {};
      try { data = JSON.parse(xhr.responseText || '{}'); } catch { /* not JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.message || `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Upload failed: connection lost'));
    xhr.send(file);
  });
}

const versionFromName = (name: string) => name.match(/(\d+\.\d+\.\d+)/)?.[1] || '';
const mb = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;

function NewRelease({ live, onUploaded }: { live: string | null; onUploaded: (release: any, notes: string, required: boolean) => void }) {
  const [exe, setExe] = useState<File | null>(null);
  const [sig, setSig] = useState<File | null>(null);
  const [version, setVersion] = useState('');
  const [notes, setNotes] = useState('');
  const [required, setRequired] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const take = (files: FileList | File[]) => {
    setError('');
    for (const f of Array.from(files)) {
      if (/\.exe$/i.test(f.name)) { setExe(f); setVersion((v) => v || versionFromName(f.name)); }
      else if (/\.sig$/i.test(f.name)) setSig(f);
      else setError(`${f.name} is not an installer (.exe) or a signature (.sig)`);
    }
  };

  const go = async () => {
    setError('');
    if (!exe || !sig) { setError('Choose both files: the .exe and the .sig next to it.'); return; }
    if (!/^\d+\.\d+\.\d+$/.test(version)) { setError('Version must look like 1.2.3'); return; }
    try {
      setProgress(0);
      const signature = (await sig.text()).trim();
      const r = await uploadInstaller(exe, version, signature, setProgress);
      setProgress(null);
      onUploaded(r.release, notes, required);
      setExe(null); setSig(null); setVersion(''); setNotes(''); setRequired(false);
    } catch (e: any) {
      setProgress(null);
      setError(e.message);
    }
  };

  return (
    <div className="space-y-4">
      <ol className="text-xs text-slate-600 dark:text-slate-300 space-y-1 list-decimal pl-4">
        <li>On your PC, in the Billing folder, run <code className="px-1 rounded bg-slate-100 dark:bg-slate-800">npm run build:update</code>. It makes the next version{live ? ` (after ${live})` : ''} in the <b>releases</b> folder.</li>
        <li>Pick (or drag here) <b>both</b> files it made: <code>ApnaBilling-x.y.z-setup.exe</code> and <code>…setup.exe.sig</code>.</li>
        <li>Write what changed, choose whether it is required, then <b>Upload &amp; publish</b> and confirm with your password.</li>
      </ol>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); take(e.dataTransfer.files); }}
        onClick={() => input.current?.click()}
        className={cx('cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition',
          dragging ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10' : 'border-slate-300 dark:border-slate-700 hover:border-emerald-400')}
      >
        <CloudUpload className="w-8 h-8 mx-auto text-slate-400" />
        <div className="mt-2 text-sm font-semibold text-slate-700 dark:text-slate-200">Drop the .exe and .sig here, or click to choose</div>
        <input ref={input} type="file" multiple accept=".exe,.sig" className="hidden" onChange={(e) => { if (e.target.files) take(e.target.files); e.target.value = ''; }} />
        <div className="mt-3 flex flex-wrap justify-center gap-2 text-xs">
          <span className={cx('inline-flex items-center gap-1 rounded-md px-2 py-1 border', exe ? 'border-emerald-300 text-emerald-700 dark:text-emerald-400' : 'border-slate-200 dark:border-slate-700 text-slate-400')}>
            {exe ? <CheckCircle2 className="w-3.5 h-3.5" /> : null}{exe ? `${exe.name} · ${mb(exe.size)}` : 'installer .exe'}
          </span>
          <span className={cx('inline-flex items-center gap-1 rounded-md px-2 py-1 border', sig ? 'border-emerald-300 text-emerald-700 dark:text-emerald-400' : 'border-slate-200 dark:border-slate-700 text-slate-400')}>
            {sig ? <FileCheck2 className="w-3.5 h-3.5" /> : null}{sig ? sig.name : 'signature .sig'}
          </span>
        </div>
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <Field label="Version"><Input value={version} onChange={(e) => setVersion(e.target.value.trim())} placeholder="1.2.3" /></Field>
        <div className="sm:col-span-2">
          <Field label="What's new (shown to clients in the popup)"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Faster billing screen, GST report fixes" /></Field>
        </div>
      </div>
      <label className="flex items-start gap-2 text-xs cursor-pointer">
        <input type="checkbox" className="mt-0.5" checked={required} onChange={(e) => setRequired(e.target.checked)} />
        <span><b>Required update</b>: clients cannot choose "Later" and must install it to keep using the app.</span>
      </label>
      {progress !== null && (
        <div>
          <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden"><div className="h-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} /></div>
          <div className="mt-1 text-[11px] text-slate-500">{progress < 100 ? `Uploading… ${progress}%` : 'Checking the signature…'}</div>
        </div>
      )}
      <Alert>{error}</Alert>
      <div className="flex justify-end">
        <Button tone="primary" busy={progress !== null} disabled={!exe || !sig} onClick={go}><Rocket className="w-3.5 h-3.5" />Upload &amp; publish</Button>
      </div>
    </div>
  );
}

export function UpdatesPage() {
  const { can } = useApp();
  const { data, error, reload } = useAsync(() => get('/app-updates'), []);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [done, setDone] = useState('');
  const owner = can('OWNER');
  const live = data?.live;

  const publish = (release: any, notes: string, required: boolean) => setConfirm({
    title: `Publish version ${release.version}`,
    action: 'Publish to all clients',
    body: <>
      <p>Every open billing app shows the update popup within seconds; closed ones show it when they next open.</p>
      <p>{required ? <b className="text-rose-600">Required: clients must install it (no "Later").</b> : 'Optional: clients can choose "Install now" or "Later".'}</p>
      {notes && <p className="italic">"{notes}"</p>}
    </>,
    run: (password, totp) => post(`/app-updates/${release.id}/publish`, { password, totp, notes: notes || undefined, required }),
  });

  return (
    <div className="space-y-4">
      <PageHeader title="App Updates" subtitle="Push a new version of the billing app to every client" />
      <Alert>{error}</Alert>
      <Alert tone="success">{done}</Alert>
      {data && !data.signingKeyConfigured && (
        <Alert>The server has no update public key yet. Run <code>npm run deploy:server</code> once from your PC.</Alert>
      )}

      <Card title="Live now" actions={owner && live && (
        <div className="flex flex-wrap gap-2">
          {live.version && (live.required
            ? <Button onClick={() => setConfirm({ title: 'Make the update optional', action: 'Make optional', body: <p>Clients will see "Install now" and "Later" again.</p>,
                run: (password, totp) => post('/app-updates/required', { password, totp, required: false }) })}>Make optional</Button>
            : <Button tone="warning" onClick={() => setConfirm({ title: `Make ${live.version} required`, action: 'Make required', body: <p>Every client on an older version must install {live.version} before they can keep working.</p>,
                run: (password, totp) => post('/app-updates/required', { password, totp, required: true }) })}><ShieldAlert className="w-3.5 h-3.5" />Make required</Button>)}
          {live.version && <Button onClick={() => setConfirm({ title: 'Pause updates', action: 'Pause', danger: true, body: <p>Clients stop seeing the update popup and cannot download {live.version} until you resume. Use this if a release has a problem.</p>,
            run: (password, totp) => post('/app-updates/pause', { password, totp }) })}><PauseCircle className="w-3.5 h-3.5" />Pause</Button>}
          {live.paused && <Button tone="primary" onClick={() => setConfirm({ title: 'Resume updates', action: 'Resume', body: <p>Clients see the update popup again.</p>,
            run: (password, totp) => post('/app-updates/resume', { password, totp }) })}><PlayCircle className="w-3.5 h-3.5" />Resume</Button>}
        </div>
      )}>
        {!live ? <div className="text-xs text-slate-400">Loading…</div> : live.version ? (
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-2xl font-bold font-['Outfit'] text-slate-900 dark:text-white">{live.version}</div>
            <Badge value={live.required ? 'REQUIRED' : 'OPTIONAL'} />
            {live.message && <div className="text-xs text-slate-500 dark:text-slate-400">"{live.message}"</div>}
          </div>
        ) : live.paused ? (
          <div className="text-sm text-amber-600">Updates are paused. Clients are not offered any update.</div>
        ) : (
          <div className="text-sm text-slate-500">No update published yet.</div>
        )}
        {data && <div className="mt-3 text-[11px] text-slate-400">Files on the server: {data.updatesDir}</div>}
      </Card>

      {owner && (
        <Card title="Publish a new version">
          <NewRelease live={live?.version || null} onUploaded={(r, notes, required) => { reload(); publish(r, notes, required); }} />
        </Card>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Clients by version">
          <Table rows={data?.versions} empty="No devices yet" columns={[
            { key: 'version', label: 'App version', render: (r) => <span className="font-mono">{r.version}</span> },
            { key: 'devices', label: 'Devices' },
            { key: 'online', label: 'Open now' },
            { key: 'state', label: '', render: (r) => (live?.version && r.version !== live.version && /^\d/.test(r.version) ? <Badge value="UPDATE_PENDING" /> : r.version === live?.version ? <Badge value="UP_TO_DATE" /> : null) },
          ]} />
        </Card>
        <Card title="History">
          <Table rows={data?.releases} empty="Nothing uploaded yet" columns={[
            { key: 'version', label: 'Version', render: (r) => <span className="font-mono font-semibold">{r.version}</span> },
            { key: 'status', label: 'Status', render: (r) => <Badge value={r.status === 'PUBLISHED' && live?.paused ? 'PAUSED' : r.status} /> },
            { key: 'size_bytes', label: 'Size', render: (r) => mb(r.size_bytes) },
            { key: 'published_at', label: 'Published', render: (r) => fmtDate(r.published_at || null, true) },
            { key: 'actions', label: '', render: (r) => owner && (
              <div className="flex gap-1 justify-end">
                {r.status === 'UPLOADED' && <Button tone="primary" onClick={() => publish(r, r.notes || '', false)}>Publish</Button>}
                {r.status !== 'PUBLISHED' && <Button tone="ghost" title="Delete this version from the server" onClick={() => setConfirm({ title: `Delete version ${r.version}`, action: 'Delete', danger: true,
                  body: <p>Removes the installer file from the server. Clients already on this version are not affected.</p>,
                  run: (password, totp) => post(`/app-updates/${r.id}/delete`, { password, totp }) })}><Trash2 className="w-3.5 h-3.5" /></Button>}
              </div>
            ) },
          ]} />
        </Card>
      </div>

      {confirm && <ConfirmPassword c={confirm} onClose={() => setConfirm(null)} onDone={(m) => { setConfirm(null); setDone(m); reload(); }} />}
    </div>
  );
}
