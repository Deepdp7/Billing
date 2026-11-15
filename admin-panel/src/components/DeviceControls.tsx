import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { del } from '../api';
import { useApp } from '../App';
import { Badge } from './ui';
import { confirmDialog, showAlert } from './dialogs';

/** Device status, with "Uninstalled" for a computer that removed Apna Billing */
export function deviceStatusCell(r: any) {
  if (r.uninstalled_at) return <Badge value="UNINSTALLED" />;
  return <span className="inline-flex gap-1"><Badge value={r.status} />{r.force_revalidate && <Badge value="REVALIDATE" />}</span>;
}

/**
 * Removes a device from the list for good. A computer that still runs Apna Billing is signed out (at once when
 * online, otherwise when it next connects) and keeps its data; it frees its device slot.
 */
export function DeleteDeviceButton({ device, onDeleted, label }: { device: any; onDeleted: () => void; label?: boolean }) {
  const { can } = useApp();
  const [busy, setBusy] = useState(false);
  if (!can('ADMIN')) return null;
  const remove = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const name = device.device_name || 'this device';
    const running = !device.uninstalled_at && device.status !== 'DEACTIVATED';
    const ok = await confirmDialog(
      running
        ? `${name} is still using this licence. Deleting it signs it out (now if it is online, otherwise when it next connects) and frees its device slot. Its shop data stays on that computer.`
        : `${name} is removed from the device list. The audit log keeps a record.`,
      { title: `Delete ${name}?`, danger: true, confirmText: 'Delete device' },
    );
    if (!ok) return;
    setBusy(true);
    try {
      await del(`/installations/${device.id}`);
      onDeleted();
    } catch (err: any) {
      void showAlert(err.message || 'Could not delete the device', { title: 'Not deleted', tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return label ? (
    <button type="button" disabled={busy} onClick={remove}
      className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50">
      <Trash2 className="h-3.5 w-3.5" />Delete device
    </button>
  ) : (
    <button type="button" disabled={busy} onClick={remove} aria-label={`Delete ${device.device_name || 'device'}`}
      className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 dark:hover:bg-rose-500/10">
      <Trash2 className="h-4 w-4" />
    </button>
  );
}
