import React, { useState } from 'react';
import { Copy, Eye, EyeOff, KeyRound } from 'lucide-react';
import { post, put } from '../api';
import { useApp } from '../App';
import { Alert, Button, Card, Field, Input, Modal, fmtAgo, fmtDate, useAction } from '../components/ui';

export interface AppAccount {
  email: string | null;
  hasPassword: boolean;
  passwordAt: string | null;
  passwordBy: string | null;
  waiting: number;
}

const SOURCE: Record<string, string> = {
  SIGNUP: 'set at sign-up',
  LOGIN: 'from a sign-in',
  SHOP: 'changed in the app',
  RESET: 'reset with an email code',
  ADMIN: 'set from this panel',
};

/**
 * The email and password the shop signs in to the billing app with. An owner can show the password (each look is in
 * the audit log); an admin can set a new email or password, which every computer of the customer takes over.
 */
export function AppSignInCard({ customerId, account, fallbackEmail, onChanged }: {
  customerId: string;
  account: AppAccount | undefined;
  fallbackEmail: string | null;
  onChanged: () => void;
}) {
  const { can } = useApp();
  const [shown, setShown] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const reveal = useAction();
  const email = account?.email || fallbackEmail;

  const toggle = () => {
    if (shown !== null) return setShown(null);
    void reveal.run(async () => setShown((await post(`/customers/${customerId}/app-password`, {})).password));
  };

  return (
    <Card title="App sign-in (billing app)" actions={can('ADMIN') && <Button onClick={() => setEditing(true)}><KeyRound className="w-3.5 h-3.5" />Change</Button>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Email</div>
          <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white break-all">{email || '—'}</div>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Password</div>
          <div className="mt-1 flex items-center gap-2">
            <span className="font-mono text-sm text-slate-900 dark:text-white select-all">
              {shown !== null ? shown : account?.hasPassword ? '••••••••••' : 'Not received yet'}
            </span>
            {can('OWNER') && account?.hasPassword && (
              <button type="button" onClick={toggle} disabled={reveal.busy} aria-label={shown !== null ? 'Hide password' : 'Show password'}
                className="p-1 rounded text-slate-400 hover:text-slate-900 hover:bg-slate-100 dark:hover:text-white dark:hover:bg-slate-800">
                {shown !== null ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            )}
            {shown !== null && (
              <button type="button" onClick={() => void navigator.clipboard?.writeText(shown)} aria-label="Copy password"
                className="p-1 rounded text-slate-400 hover:text-slate-900 hover:bg-slate-100 dark:hover:text-white dark:hover:bg-slate-800">
                <Copy className="w-4 h-4" />
              </button>
            )}
          </div>
          {account?.passwordAt && (
            <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              {SOURCE[account.passwordBy || ''] || 'updated'} · {fmtDate(account.passwordAt, true)} ({fmtAgo(account.passwordAt)})
            </div>
          )}
        </div>
      </div>
      <div className="mt-3 space-y-2">
        <Alert>{reveal.msg?.tone === 'error' ? reveal.msg.text : null}</Alert>
        {!account?.hasPassword && (
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            The password arrives the next time the shop signs in, signs up or resets its password with an updated billing app.
          </p>
        )}
        {!!account?.waiting && (
          <p className="text-[11px] text-amber-700 dark:text-amber-300">
            A change is waiting for {account.waiting} computer{account.waiting === 1 ? '' : 's'}: it is taken over as soon as the billing app is online.
          </p>
        )}
      </div>
      {editing && (
        <ChangeSignInModal customerId={customerId} email={email || ''} onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); setShown(null); onChanged(); }} />
      )}
    </Card>
  );
}

function ChangeSignInModal({ customerId, email, onClose, onSaved }: { customerId: string; email: string; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ email, password: '' });
  const [show, setShow] = useState(false);
  const { busy, msg, setMsg, run } = useAction();
  const save = () => {
    const newEmail = f.email.trim().toLowerCase();
    const changes: Record<string, string> = {};
    if (newEmail && newEmail !== email.toLowerCase()) {
      if (!/^\S+@\S+\.\S+$/.test(newEmail)) return setMsg({ tone: 'error', text: 'Enter a valid email address.' });
      changes.email = newEmail;
    }
    if (f.password) {
      if (f.password.length < 8) return setMsg({ tone: 'error', text: 'The password needs at least 8 characters.' });
      changes.password = f.password;
    }
    if (!Object.keys(changes).length) return setMsg({ tone: 'error', text: 'Enter a new email or a new password.' });
    void run(async () => {
      await put(`/customers/${customerId}/app-account`, changes);
      onSaved();
    });
  };
  return (
    <Modal title="Change app sign-in" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button tone="primary" busy={busy} onClick={save}>Save</Button></>}>
      <Alert tone={msg?.tone}>{msg?.text}</Alert>
      <Field label="Sign-in email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
      <Field label="New password" hint="Leave empty to keep the current password. At least 8 characters.">
        <div className="relative">
          <Input type={show ? 'text' : 'password'} value={f.password} autoComplete="new-password" className="pr-9"
            onChange={(e) => setF({ ...f, password: e.target.value })} />
          <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-900 dark:hover:text-white">
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </Field>
      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        The billing app takes this over at once when it is online (otherwise the next time it connects). Tell the shop their new sign-in.
      </p>
    </Modal>
  );
}
