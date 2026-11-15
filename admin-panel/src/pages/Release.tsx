import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ChevronDown, FolderOpen, Hammer, Package, Plus, Server, ShieldAlert, Square, Upload } from 'lucide-react';
import { Button, Card, Field, Input, cx } from '../components/ui';
import { confirmDialog, showAlert } from '../components/dialogs';
import { isDesktopApp, release, type ReleaseInfo, type ReleaseRun } from '../lib/desktop';

/**
 * The parts of Updates & Releases that only exist in the Admin app: building the billing app and this Admin app on
 * this PC, making their installers with Installer Studio, signing them and uploading the server, by running
 * deploy/apna_vps.py (admin-tauri/src-tauri/src/release.rs). Same steps as docs/UPDATE_GUIDE.md, as buttons.
 */

/** 1.2.3, or 1.2.3+2 for update 2 of the same version (clients still see 1.2.3) */
export const VERSION = /^\d+\.\d+\.\d+(\+\d+)?$/;
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
const READY = /(?:Installer ready: |Admin app ready: |Program ready in )(.+)/g;
const MAX_LOG = 400_000;

const parts = (v: string) => {
  const [main, update] = v.split('+');
  const p = main.split('.').map(Number);
  return [p[0] || 0, p[1] || 0, p[2] || 0, Number(update) || 0];
};
/** The next version: 1.2.3 (or 1.2.3+2) → 1.2.4 */
export const bump = (v: string) => (VERSION.test(v) ? v.split('+')[0].replace(/(\d+)$/, (n) => String(Number(n) + 1)) : v);
/** Another update of the same version: 1.2.3 → 1.2.3+1, 1.2.3+1 → 1.2.3+2 (clients still see 1.2.3) */
export const nextUpdate = (v: string) => (VERSION.test(v) ? `${v.split('+')[0]}+${parts(v)[3] + 1}` : v);
/** 1.2.3+2 → "1.2.3 (update 2)" */
export const fmtVersion = (v: string) => (v.includes('+') ? `${v.split('+')[0]} (update ${v.split('+')[1]})` : v);
/** Whether a is newer than b; 1.2.3 < 1.2.3+1 < 1.2.3+2 < 1.2.4 */
export const newer = (a: string, b: string) => {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};

// ---- Run state and output, kept while the window is open so they survive moving to another page

type Status = { kind: 'idle' | 'running' | 'done' | 'failed'; title: string };
type Snap = { log: string; status: Status; info: ReleaseInfo | null; error: string };
let snap: Snap = { log: '', status: { kind: 'idle', title: '' }, info: null, error: '' };
const subscribers = new Set<() => void>();
let askedReset = false;
let listening = false;

function setSnap(next: Partial<Snap>) {
  snap = { ...snap, ...next };
  subscribers.forEach((f) => f());
}

export function loadInfo() {
  return release.info().then((info) => {
    setSnap({ info, error: '' });
    if (info.running && snap.status.kind !== 'running') setSnap({ status: { kind: 'running', title: info.running } });
  }).catch((e) => setSnap({ error: String(e?.message || e) }));
}

function append(text: string) {
  const clean = text.replace(ANSI, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const log = (snap.log + clean).slice(-MAX_LOG);
  setSnap({ log });
  if (!askedReset && log.slice(-4000).includes('Type the word RESET')) {
    askedReset = true;
    const tail = log.slice(-4000);
    const state = tail.slice(tail.lastIndexOf('Update state on the VPS now'), tail.lastIndexOf('Forget all of this')).trim();
    void confirmDialog(`${state}\n\nForget all of this on the VPS, so the next version can be any number? Licences and customers are not touched.`,
      { title: 'Reset update history', danger: true, confirmText: 'Reset' })
      .then((ok) => release.answer(ok))
      .catch(() => {});
  }
}

function listenOnce() {
  if (listening) return;
  listening = true;
  void release.onOutput(append);
  void release.onDone(({ title, code }) => {
    setSnap({ status: { kind: code === 0 ? 'done' : 'failed', title } });
    void loadInfo();
    const tail = snap.log.slice(-6000);
    if (code === 0 && title.startsWith('Uploading the Admin Panel')) {
      void showAlert('The server is updated. This page reloads now to show the new Admin Panel.', { title: 'Done', tone: 'success' })
        .then(() => window.location.reload());
    } else if (code === 0) {
      const ready = [...tail.matchAll(READY)].pop()?.[1]?.trim();
      if (!ready) {
        void showAlert(`${title}: done.`, { title: 'Done', tone: 'success' });
        return;
      }
      const name = ready.split(/[\\/]/).pop() || '';
      void confirmDialog(`${title}: done.\n\n${ready}\n\nShow it in the folder?`, { title: 'Done', tone: 'success', confirmText: 'Show it' })
        .then((ok) => { if (ok) void release.open(name.toLowerCase().endsWith('.exe') ? `file:${name}` : 'releases'); })
        .catch(() => {});
    } else {
      const last = tail.trim().split('\n').filter((l) => l.trim()).pop() || '';
      void showAlert(`${title} did not finish.\n\n${last}\n\nThe output on this page shows the details.`, { title: 'Something went wrong', tone: 'error' });
    }
  });
}

/** Run state, output and what is on this PC; starts listening the first time it is used */
export function useRelease() {
  const s = useSyncExternalStore((f) => { subscribers.add(f); return () => subscribers.delete(f); }, () => snap);
  useEffect(() => { if (isDesktopApp()) { listenOnce(); void loadInfo(); } }, []);
  return s;
}

export async function startRun(r: ReleaseRun, title: string) {
  if (snap.status.kind === 'running') return;
  askedReset = false;
  setSnap({ status: { kind: 'running', title } });
  try {
    await release.run(r);
  } catch (e: any) {
    setSnap({ status: { kind: 'idle', title: '' } });
    void showAlert(String(e?.message || e), { title, tone: 'error' });
  }
}

export const openPlace = (target: string) => release.open(target).catch((e) => showAlert(String(e?.message || e), { tone: 'warning' }));

// ---- Pieces

export const Hint = ({ children }: { children: React.ReactNode }) => <p className="mt-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{children}</p>;

function VersionField({ current, next, again, value, onChange }: { current: string; next: string; again?: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="w-32"><Field label="Version to build"><Input value={value} onChange={(e) => onChange(e.target.value.trim())} placeholder="1.0.0" /></Field></div>
      <Button onClick={() => onChange(next)}><Plus className="w-3.5 h-3.5" />Next update ({next})</Button>
      {again && <Button onClick={() => onChange(again)} title={`Clients keep seeing ${again.split('+')[0]}, and still get these changes`}>Update {again.split('+')[0]} again ({again})</Button>}
      <Button tone="ghost" onClick={() => onChange(current)}>Same as now ({current})</Button>
    </div>
  );
}

/** The highest of these versions (ignores anything that is not x.y.z) */
const highest = (versions: string[]) => versions.filter((v) => VERSION.test(v)).reduce((a, v) => (newer(v, a) ? v : a), '0.0.0');

/** "Advanced" part that opens on click */
function More({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
        <ChevronDown className={cx('w-3.5 h-3.5 transition', open ? '' : '-rotate-90')} />{label}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

async function withVersion(action: ReleaseRun['action'], v: string, current: string, title: string, warnLower: boolean) {
  if (!VERSION.test(v)) return void showAlert('The version must look like 1.0.0 (three numbers with dots).', { tone: 'warning' });
  if (warnLower && VERSION.test(current) && newer(current, v)
    && !(await confirmDialog(`${v} is lower than the current ${current}. Apps that already have ${current} will not update to it. Build ${v} anyway?`, { tone: 'warning' }))) return;
  void startRun({ action, version: v }, title);
}

function openStudio(info: ReleaseInfo | null, which: 'client' | 'admin') {
  if (!info?.studio) return void showAlert('Installer Studio is not installed yet. Use "Open its setup" at the top of this page.', { tone: 'warning' });
  void openPlace(`studio-${which}`);
}

/** Problems with this PC's setup (Billing folder, Installer Studio), shown at the top */
export function SetupNotes({ info, error }: { info: ReleaseInfo | null; error: string }) {
  if (error) {
    return <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
      Building on this PC needs the newest Admin app ({error}).</div>;
  }
  return (
    <>
      {info && !info.found && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
          The Billing folder was not found at <b>{info.repo}</b>. The Admin app builds from the folder it was built from.
        </div>
      )}
      {info && !info.studio && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
          <span><b>Installer Studio is not installed</b>, so installers cannot be made yet. Open its setup and click Next → Install → Finish.</span>
          <Button onClick={() => openPlace('studio-setup')}>Open its setup</Button>
        </div>
      )}
    </>
  );
}

export const ReleasesFolderButton = () => <Button onClick={() => openPlace('releases')}><FolderOpen className="w-3.5 h-3.5" />Releases folder</Button>;

/**
 * Step 1: build the billing app's installer. The numbers follow what clients use: "Same as now" is the live version,
 * "Next update" is one above the highest version on the server (after a rollback that is above the newer one still in
 * History, which the server would refuse again). Without anything on the server they follow the last build here.
 */
export function BuildClientCard({ busy, info, published, live }: { busy: boolean; info: ReleaseInfo | null; published: string[]; live: { version: string | null; rollback?: boolean } | null }) {
  const built = info?.clientVersion || '?';
  const onServer = [...published, ...(live?.version ? [live.version] : [])].filter((v) => VERSION.test(v));
  const current = live?.version || (onServer.length ? highest(onServer) : built);
  const next = bump(onServer.length ? highest(onServer) : built);
  // Another update with the same number: one above the highest update of the live version on the server
  const again = VERSION.test(current) ? nextUpdate(highest([current, ...onServer.filter((v) => v.split('+')[0] === current.split('+')[0])])) : undefined;
  const [version, setVersion] = useState('');
  // Ready for the next update, and up to date again after every build or publish
  useEffect(() => { if (VERSION.test(next)) setVersion(next); }, [next]);
  return (
    <Card title={<span className="flex items-center gap-2"><Hammer className="w-4 h-4 text-emerald-500" />1 · Build the new version
      <span className="font-normal text-slate-500">({live?.version ? `clients use ${live.version}${live.rollback ? ', rolled back' : ''} · ` : ''}last built {built})</span></span>}>
      <VersionField current={current} next={next} again={again} value={version} onChange={setVersion} />
      <div className="mt-3">
        <Button tone="primary" disabled={busy} onClick={() => withVersion('build-client', version, current, `Building the client installer ${version}`, true)}>
          <Hammer className="w-3.5 h-3.5" />Build client installer {VERSION.test(version) ? version : ''}
        </Button>
      </div>
      <Hint>For an update press <b>Next update</b>, then build. To send changes without changing the number clients see, press
        <b> Update {current.split('+')[0]} again</b> instead (they still see {current.split('+')[0]}). Makes <b>ApnaBilling-&lt;version&gt;-setup.exe</b> (also the installer for new
        clients) and its <b>.sig</b> in the releases folder, using Installer Studio with your project and pictures. Takes a few minutes.</Hint>
      <More label="Or make the installer in Installer Studio's window">
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => withVersion('prepare-client', version, current, `Preparing the client program ${version}`, true)}>1. Prepare the program</Button>
          <Button onClick={() => openStudio(info, 'client')}>2. Open in Installer Studio</Button>
          <Button disabled={busy} onClick={() => void startRun({ action: 'sign-client', version: built }, `Signing ApnaBilling-${built}-setup.exe`)}>3. Sign the installer</Button>
        </div>
        <Hint>In Installer Studio change anything you like (icon, pictures, options), press Save, then <b>Build installer</b>. Step 3 signs it so clients' apps accept it as an update.</Hint>
      </More>
    </Card>
  );
}

/** Live output of the run in progress (or the last one) */
export function OutputCard({ log, status }: { log: string; status: Status }) {
  const ref = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight }); }, [log]);
  // As soon as a button starts something, the page glides down to this box, so its output is in view
  useEffect(() => {
    if (status.kind === 'running') box.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [status.kind, status.title]);
  if (!log && status.kind === 'idle') return null;
  const busy = status.kind === 'running';
  return (
    <div ref={box} className="scroll-mt-4">
    <Card title="What is happening" actions={
      <div className="flex items-center gap-2">
        <Button tone="ghost" disabled={busy} onClick={() => setSnap({ log: '', status: { kind: 'idle', title: '' } })}>Clear</Button>
        <Button tone="danger" disabled={!busy} onClick={async () => {
          if (await confirmDialog(`Stop "${status.title}"?`, { danger: true, confirmText: 'Stop' })) {
            append('\nStopped. If a version number was being changed, check it before building again.\n');
            void release.stop();
          }
        }}><Square className="w-3.5 h-3.5" />Stop</Button>
      </div>}>
      <div className={cx('mb-2 text-xs font-semibold',
        busy ? 'text-indigo-600 dark:text-indigo-300' : status.kind === 'done' ? 'text-emerald-600 dark:text-emerald-400'
          : status.kind === 'failed' ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500')}>
        {busy ? `Working: ${status.title}…` : status.kind === 'done' ? `Done: ${status.title}` : status.kind === 'failed' ? `Failed: ${status.title}` : 'Last output'}
      </div>
      <div ref={ref} className="h-72 overflow-y-auto rounded-lg bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-200">
        {log.split('\n').slice(-1500).map((line, i) => (
          <div key={i} className={cx('whitespace-pre-wrap break-words',
            line.startsWith('▶') ? 'font-bold text-indigo-300' : line.startsWith('==>') ? 'font-bold text-emerald-400'
              : /\berror\b|traceback|failed/i.test(line) ? 'text-rose-300' : '')}>{line || ' '}</div>
        ))}
      </div>
    </Card>
    </div>
  );
}

/** Building this Admin app, and uploading the server */
export function AdminAndServerCards({ busy, info }: { busy: boolean; info: ReleaseInfo | null }) {
  const current = info?.adminVersion || '?';
  const [version, setVersion] = useState('');
  const [vpsPassword, setVpsPassword] = useState('');
  // Follows the Admin app's version (up to date again after every build)
  useEffect(() => { if (VERSION.test(current)) setVersion(current); }, [current]);
  const vps = (r: ReleaseRun, title: string) => {
    if (!vpsPassword) return void showAlert('Type the VPS password first.', { tone: 'warning' });
    void startRun({ ...r, vpsPassword }, title);
  };
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card title={<span className="flex items-center gap-2"><Package className="w-4 h-4 text-indigo-500" />Admin app (this app) <span className="font-normal text-slate-500">(now {current})</span></span>}>
        <VersionField current={current} next={bump(current)} value={version} onChange={setVersion} />
        <div className="mt-3">
          <Button tone="primary" disabled={busy} onClick={() => withVersion('build-admin', version, current, `Building the Admin app installer ${version}`, false)}>
            <Hammer className="w-3.5 h-3.5" />Build Admin app installer
          </Button>
        </div>
        <Hint>Makes <b>ApnaBillingAdmin-&lt;version&gt;-setup.exe</b>. Install it on <b>your PC only</b>, never on a client's. Only needed when the
          Admin app itself changed; Admin Panel pages come from the server (next card).</Hint>
        <More label="Or make the installer in Installer Studio's window">
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => withVersion('prepare-admin', version, current, `Preparing the Admin app program ${version}`, false)}>1. Prepare the program</Button>
            <Button onClick={() => openStudio(info, 'admin')}>2. Open in Installer Studio</Button>
          </div>
          <Hint>In Installer Studio press <b>Build installer</b>. The Admin app needs no signing.</Hint>
        </More>
      </Card>

      <Card title={<span className="flex items-center gap-2"><Server className="w-4 h-4 text-slate-500" />Server (VPS)</span>}>
        <Field label="VPS password" hint="Only for the buttons on this card. Kept only while this page is open, never saved.">
          <Input type="password" autoComplete="off" value={vpsPassword} onChange={(e) => setVpsPassword(e.target.value)} />
        </Field>
        <div className="mt-3">
          <Button tone="primary" disabled={busy} onClick={() => vps({ action: 'deploy-server' }, 'Uploading the Admin Panel and licence server to the VPS')}>
            <Upload className="w-3.5 h-3.5" />Upload Admin Panel and licence server
          </Button>
        </div>
        <Hint>After changing the Admin Panel or the licence server. Clients do nothing; their apps keep working during the few-second restart.</Hint>
        <More label="Rarely needed">
          <div className="rounded-lg border border-rose-200 p-3 dark:border-rose-500/30">
            <div className="flex items-center gap-2 text-xs font-bold text-rose-700 dark:text-rose-300"><ShieldAlert className="w-4 h-4" />Reset update history</div>
            <Hint>Forgets every published version on the VPS so version numbers can start lower again (e.g. 1.0.0). Only when no client has the app yet. You see what is there and confirm first.</Hint>
            <Button className="mt-2" tone="danger" disabled={busy} onClick={() => vps({ action: 'reset-updates' }, 'Reset update history')}>Reset update history…</Button>
          </div>
        </More>
      </Card>
    </div>
  );
}
