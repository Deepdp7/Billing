import React, { useMemo, useRef, useState } from 'react';
import { CheckCircle2, CloudUpload, FileCheck2, PackageCheck, PauseCircle, PlayCircle, Rocket, ShieldAlert, Trash2, X } from 'lucide-react';
import { get, post, session } from '../api';
import { useApp } from '../App';
import { Alert, Badge, Button, Card, Field, Input, Modal, PageHeader, Table, Textarea, cx, fmtDate, useAction, useAsync } from '../components/ui';
import { isDesktopApp, release, type ReleaseInfo } from '../lib/desktop';
import { AdminAndServerCards, BuildClientCard, OutputCard, ReleasesFolderButton, SetupNotes, VERSION, fmtVersion, newer, useRelease } from './Release';

/**
 * Updates & Releases: what clients are offered now, publishing a new version, who has which version, and history.
 * In the Admin app it also builds the new version on this PC (Release.tsx) and publishes the built files directly.
 */

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

const versionFromName = (name: string) => name.match(/(\d+\.\d+\.\d+(?:\+\d+)?)/)?.[1] || '';
const INSTALLER = /^ApnaBilling-(\d+\.\d+\.\d+(?:\+\d+)?)-setup\.exe$/;
const mb = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;

type Built = { version: string; exe: string; sig: string; size: number; modified: number };

/** The newest signed installer in the releases folder that clients do not have yet and that is not on the server */
function builtToPublish(info: ReleaseInfo | null, live: string | null, uploaded: string[]): Built | null {
  if (!info) return null;
  const names = new Set(info.files.map((f) => f.name));
  let best: Built | null = null;
  for (const f of info.files) {
    const v = f.name.match(INSTALLER)?.[1];
    if (!v || !names.has(`${f.name}.sig`) || uploaded.includes(v) || (live && !newer(v, live))) continue;
    if (!best || newer(v, best.version)) best = { version: v, exe: f.name, sig: `${f.name}.sig`, size: f.size, modified: f.modified };
  }
  return best;
}

/** Signed installers in the releases folder that are older than the live version and not on the server: what a
 *  rollback can go back to (one already on the server is rolled back to from History) */
function builtOlder(info: ReleaseInfo | null, live: string | null, uploaded: string[]): Built[] {
  if (!info || !live) return [];
  const names = new Set(info.files.map((f) => f.name));
  return info.files
    .map((f) => ({ f, v: f.name.match(INSTALLER)?.[1] }))
    .filter(({ f, v }) => v && names.has(`${f.name}.sig`) && !uploaded.includes(v) && newer(live, v))
    .map(({ f, v }) => ({ version: v!, exe: f.name, sig: `${f.name}.sig`, size: f.size, modified: f.modified }))
    .sort((a, b) => (newer(a.version, b.version) ? -1 : 1));
}

/** × on a chosen file: takes it out again (inside the drop area, so it must not open the file picker) */
function RemoveFile({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" aria-label={`Remove the ${label}`} title={`Remove the ${label}`}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="ml-0.5 rounded p-0.5 text-current opacity-60 hover:bg-emerald-100 hover:opacity-100 dark:hover:bg-emerald-500/20">
      <X className="w-3 h-3" />
    </button>
  );
}

/**
 * The installer built last on this PC, when its version is already on the server and the file is newer than that
 * upload: built again with the same number. It cannot go to clients (a computer on 1.0.1 never installs "1.0.1" again,
 * and the server refuses the number), so the page says what to do instead of offering it.
 */
function rebuiltSameVersion(info: ReleaseInfo | null, releases: any[]): Built | null {
  if (!info) return null;
  const v = info.clientVersion;
  const rel = releases.find((r) => r.version === v);
  const file = info.files.find((f) => f.name === `ApnaBilling-${v}-setup.exe`);
  if (!rel || !file) return null;
  const onServerAt = Date.parse(rel.published_at || rel.uploaded_at || '') || 0;
  return file.modified > onServerAt ? { version: v, exe: file.name, sig: `${file.name}.sig`, size: file.size, modified: file.modified } : null;
}

function NewRelease({ live, built, older, rebuilt, onUploaded }: {
  live: string | null; built: Built | null; older: Built[]; rebuilt: Built | null; onUploaded: (release: any, notes: string, required: boolean) => void;
}) {
  const [exe, setExe] = useState<File | null>(null);
  const [sig, setSig] = useState<File | null>(null);
  const [version, setVersion] = useState('');
  const [notes, setNotes] = useState('');
  const [required, setRequired] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const desktop = isDesktopApp();

  const takeBuilt = async (b: Built) => {
    setError('');
    setLoading(true);
    try {
      const [e, s] = await Promise.all([release.file(b.exe), release.file(b.sig)]);
      setExe(e); setSig(s); setVersion(b.version);
    } catch (err: any) {
      setError(String(err?.message || err));
    } finally {
      setLoading(false);
    }
  };

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
    if (!VERSION.test(version)) { setError('Version must look like 1.2.3 (or 1.2.3+2 for another update of 1.2.3)'); return; }
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
      {desktop && rebuilt && !built && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
          <div className="text-sm font-bold">Version {rebuilt.version} was built again, but {rebuilt.version} is already on the server</div>
          <p className="mt-1 leading-relaxed">
            Computers that have {rebuilt.version} never install another {rebuilt.version}, so it cannot be published again. To send these changes
            to every client, go to <b>1 · Build the new version</b> and press <b>Update {rebuilt.version.split('+')[0]} again</b> (clients keep
            seeing {rebuilt.version.split('+')[0]}) or <b>Next update</b>, then build. This installer is still fine to give to <b>new</b> clients.
          </p>
          <Button className="mt-2" onClick={() => void release.open(`file:${rebuilt.exe}`)}>Show this installer</Button>
        </div>
      )}
      {desktop && older.some((b) => b.exe !== exe?.name) && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
          <span>Or go back to an older version (rollback):</span>
          {older.filter((b) => b.exe !== exe?.name).map((b) => (
            <Button key={b.version} tone="ghost" busy={loading} onClick={() => takeBuilt(b)}>Use {b.version}</Button>
          ))}
        </div>
      )}
      {desktop ? (
        built && exe?.name !== built.exe ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-500/30 dark:bg-emerald-500/10">
            <div className="flex items-center gap-3">
              <PackageCheck className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
              <div>
                <div className="text-sm font-bold text-slate-800 dark:text-slate-100">Version {fmtVersion(built.version)} is built and ready</div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">{built.exe} · {mb(built.size)} · {fmtDate(new Date(built.modified).toISOString(), true)} · signed</div>
              </div>
            </div>
            <Button tone="primary" busy={loading} onClick={() => takeBuilt(built)}>Use version {built.version}</Button>
          </div>
        ) : !built && !exe && !rebuilt ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">Build the new version above first{live ? ` (newer than ${live})` : ''}. It shows up here, ready to publish.</p>
        ) : null
      ) : (
        <ol className="text-xs text-slate-600 dark:text-slate-300 space-y-1 list-decimal pl-4">
          <li>Build the next version{live ? ` (after ${live})` : ''} in the Admin app, or on your PC with <code className="px-1 rounded bg-slate-100 dark:bg-slate-800">npm run build:update</code>.</li>
          <li>Pick (or drag here) <b>both</b> files it made: <code>ApnaBilling-x.y.z-setup.exe</code> and <code>…setup.exe.sig</code>.</li>
          <li>Write what changed, choose whether it is required, then <b>Upload &amp; publish</b> and confirm with your password.</li>
        </ol>
      )}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); take(e.dataTransfer.files); }}
        onClick={() => input.current?.click()}
        className={cx('cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition',
          dragging ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10' : 'border-slate-300 dark:border-slate-700 hover:border-emerald-400')}
      >
        <CloudUpload className="w-8 h-8 mx-auto text-slate-400" />
        <div className="mt-2 text-sm font-semibold text-slate-700 dark:text-slate-200">{desktop ? 'Or drop other files here (.exe and .sig), or click to choose' : 'Drop the .exe and .sig here, or click to choose'}</div>
        <input ref={input} type="file" multiple accept=".exe,.sig" className="hidden" onChange={(e) => { if (e.target.files) take(e.target.files); e.target.value = ''; }} />
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-xs">
          <span className={cx('inline-flex items-center gap-1 rounded-md px-2 py-1 border', exe ? 'border-emerald-300 text-emerald-700 dark:text-emerald-400' : 'border-slate-200 dark:border-slate-700 text-slate-400')}>
            {exe ? <CheckCircle2 className="w-3.5 h-3.5" /> : null}{exe ? `${exe.name} · ${mb(exe.size)}` : 'installer .exe'}
            {exe && <RemoveFile label="installer" onClick={() => { setExe(null); setVersion(''); }} />}
          </span>
          <span className={cx('inline-flex items-center gap-1 rounded-md px-2 py-1 border', sig ? 'border-emerald-300 text-emerald-700 dark:text-emerald-400' : 'border-slate-200 dark:border-slate-700 text-slate-400')}>
            {sig ? <FileCheck2 className="w-3.5 h-3.5" /> : null}{sig ? sig.name : 'signature .sig'}
            {sig && <RemoveFile label="signature" onClick={() => setSig(null)} />}
          </span>
          {(exe || sig) && (
            <button type="button" disabled={progress !== null}
              onClick={(e) => { e.stopPropagation(); setExe(null); setSig(null); setVersion(''); setError(''); }}
              className="rounded-md px-2 py-1 font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50 dark:hover:bg-slate-800 dark:hover:text-slate-100">
              Clear
            </button>
          )}
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
  // Building on this PC: only the owner, only in the Admin app
  const desktop = owner && isDesktopApp();
  const run = useRelease();
  const busy = run.status.kind === 'running';
  const uploaded = useMemo(() => (data?.releases || []).map((r: any) => r.version as string), [data?.releases]);
  const built = useMemo(() => (desktop ? builtToPublish(run.info, live?.version || null, uploaded) : null), [desktop, run.info, live?.version, uploaded]);
  const older = useMemo(() => (desktop ? builtOlder(run.info, live?.version || null, uploaded) : []), [desktop, run.info, live?.version, uploaded]);
  const rebuilt = useMemo(() => (desktop ? rebuiltSameVersion(run.info, data?.releases || []) : null), [desktop, run.info, data?.releases]);

  // Publishing a version that is not newer than every published one is a rollback: all computers go back to it
  const publish = (release: any, notes: string, required: boolean) => {
    const newest = (data?.releases || [])
      .filter((r: any) => r.id !== release.id && (r.status === 'PUBLISHED' || r.status === 'SUPERSEDED'))
      .map((r: any) => r.version as string)
      .reduce((a: string, v: string) => (newer(v, a) ? v : a), '0.0.0');
    const rollback = newest !== '0.0.0' && !newer(release.version, newest);
    setConfirm(rollback ? {
      title: `Roll back to version ${release.version}`,
      action: 'Roll back all clients',
      danger: true,
      body: <>
        <p>Every computer on another version (also those on {newest}) is offered {release.version} and goes back to it when it installs it.
          Each computer keeps its data.</p>
        <p><b>Only roll back if {newest} did not change the database</b> (new tables or columns): {release.version} may not work with them.</p>
        <p>{required ? <b className="text-rose-600">Required: clients must install it (no "Later").</b> : 'Optional: clients can choose "Install now" or "Later".'}</p>
        {notes && <p className="italic">"{notes}"</p>}
      </>,
      run: (password, totp) => post(`/app-updates/${release.id}/publish`, { password, totp, notes: notes || undefined, required, rollback: true }),
    } : {
      title: `Publish version ${release.version}`,
      action: 'Publish to all clients',
      body: <>
        <p>Every open billing app shows the update popup within seconds; closed ones show it when they next open.</p>
        <p>{required ? <b className="text-rose-600">Required: clients must install it (no "Later").</b> : 'Optional: clients can choose "Install now" or "Later".'}</p>
        {notes && <p className="italic">"{notes}"</p>}
      </>,
      run: (password, totp) => post(`/app-updates/${release.id}/publish`, { password, totp, notes: notes || undefined, required }),
    });
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Updates & Releases"
        subtitle={desktop ? 'Build a new version on this PC, publish it to every client, and see who has it.' : 'Publish a new version of the billing app to every client'}
        actions={desktop && <ReleasesFolderButton />} />
      <Alert>{error}</Alert>
      <Alert tone="success">{done}</Alert>
      {desktop && <SetupNotes info={run.info} error={run.error} />}
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
            <div className="text-2xl font-bold font-['Outfit'] text-slate-900 dark:text-white">{fmtVersion(live.version)}</div>
            <Badge value={live.required ? 'REQUIRED' : 'OPTIONAL'} />
            {live.rollback && <Badge value="ROLLED_BACK" />}
            {live.message && <div className="text-xs text-slate-500 dark:text-slate-400">"{live.message}"</div>}
          </div>
        ) : live.paused ? (
          <div className="text-sm text-amber-600">Updates are paused. Clients are not offered any update.</div>
        ) : (
          <div className="text-sm text-slate-500">No update published yet.</div>
        )}
        {data && <div className="mt-3 text-[11px] text-slate-400">Files on the server: {data.updatesDir}</div>}
      </Card>

      {desktop && <BuildClientCard busy={busy} info={run.info} published={uploaded} live={live || null} />}
      {desktop && <OutputCard log={run.log} status={run.status} />}

      {owner && (
        <Card title={desktop ? <span className="flex items-center gap-2"><Rocket className="w-4 h-4 text-indigo-500" />2 · Publish it to every client</span> : 'Publish a new version'}>
          <NewRelease live={live?.version || null} built={built} older={older} rebuilt={rebuilt} onUploaded={(r, notes, required) => { reload(); publish(r, notes, required); }} />
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
                {r.status === 'SUPERSEDED' && <Button title="Put this version live again: every computer goes back to it" onClick={() => publish(r, r.notes || '', false)}>Roll back to this</Button>}
                {r.status !== 'PUBLISHED' && <Button tone="ghost" title="Delete this version from the server" onClick={() => setConfirm({ title: `Delete version ${r.version}`, action: 'Delete', danger: true,
                  body: <p>Removes the installer file from the server. Clients already on this version are not affected.</p>,
                  run: (password, totp) => post(`/app-updates/${r.id}/delete`, { password, totp }) })}><Trash2 className="w-3.5 h-3.5" /></Button>}
              </div>
            ) },
          ]} />
        </Card>
      </div>

      {desktop && (
        <>
          <div className="pt-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">Admin app and server</div>
          <AdminAndServerCards busy={busy} info={run.info} />
        </>
      )}

      {confirm && <ConfirmPassword c={confirm} onClose={() => setConfirm(null)} onDone={(m) => { setConfirm(null); setDone(m); reload(); }} />}
    </div>
  );
}
