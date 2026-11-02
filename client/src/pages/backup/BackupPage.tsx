import React, { useState, useEffect } from 'react';
import { api, downloadFile } from '../../lib/api';
import { 
  Database, 
  Download, 
  Upload, 
  ShieldCheck, 
  Clock, 
  CheckCircle2, 
  AlertTriangle,
  RefreshCw,
  HardDrive,
  Trash2,
  Settings2
} from 'lucide-react';
import { confirmDialog } from '../../components/ui/dialogs.js';

export const BackupPage: React.FC = () => {
  const [backups, setBackups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [snapshotName, setSnapshotName] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [selectedBackupToRestore, setSelectedBackupToRestore] = useState<any>(null);
  const [restoring, setRestoring] = useState(false);
  const [settings, setSettings] = useState<any>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);

  useEffect(() => {
    fetchBackups();
  }, []);

  const fetchBackups = async () => {
    try {
      setLoading(true);
      const res: any = await api.getBackups();
      setBackups(res.backups);
      if (res.settings) setSettings(res.settings);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to fetch backups');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSnapshot = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setCreating(true);
      await api.createBackupSnapshot(snapshotName || undefined);
      setErrorMessage('');
      setSuccessMessage('Backup file created and verified (integrity check passed).');
      setSnapshotName('');
      fetchBackups();
      setTimeout(() => setSuccessMessage(''), 4000);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to create backup');
    } finally {
      setCreating(false);
    }
  };

  // Previously opened a URL with ?token=, which the API never accepted (always 401). Now an authenticated download.
  const handleExportJson = async () => {
    try {
      await downloadFile('/app/backups/export', 'apna-billing-export.json');
    } catch (err: any) {
      setErrorMessage(err.message || 'Export failed');
    }
  };

  const handleVerify = async (b: any) => {
    try {
      const r = await api.verifyBackup(b.id);
      const ok = r.backup.status === 'VERIFIED' && r.backup.checksumMatches;
      if (ok) { setErrorMessage(''); setSuccessMessage(`${b.file_name}: integrity OK, checksum matches.`); }
      else setErrorMessage(`${b.file_name}: ${r.backup.status} — ${r.backup.integrity || 'checksum mismatch'}`);
      fetchBackups();
    } catch (err: any) {
      setErrorMessage(err.message || 'Verification failed');
    }
  };

  const handleDelete = async (b: any) => {
    if (!(await confirmDialog(`Delete backup file ${b.file_name}? This cannot be undone.`, { danger: true }))) return;
    try {
      await api.deleteBackup(b.id);
      fetchBackups();
    } catch (err: any) {
      setErrorMessage(err.message || 'Delete failed');
    }
  };

  const handleSaveSettings = async () => {
    try {
      setSavingSettings(true);
      const r = await api.updateBackupSettings({
        backupDir: settings.backupDir,
        autoBackupEnabled: settings.autoBackupEnabled,
        autoBackupIntervalHours: Number(settings.autoBackupIntervalHours),
        keepAutoBackups: Number(settings.keepAutoBackups),
      });
      setSettings(r.settings);
      setErrorMessage('');
      setSuccessMessage('Backup settings saved.');
    } catch (err: any) {
      setErrorMessage(err.message || 'Could not save settings');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleRestoreFromFile = async () => {
    if (!restoreFile) return;
    if (!(await confirmDialog(`Restore all business data from ${restoreFile.name}? A safety backup of the current data is created first.`, { danger: true }))) return;
    try {
      setRestoring(true);
      await api.restoreBackupFromFile(restoreFile);
      setErrorMessage('');
      setSuccessMessage(`Restored from ${restoreFile.name}. A safety backup of the previous data was saved. Reloading…`);
      setTimeout(() => window.location.reload(), 1500);
    } catch (err: any) {
      setErrorMessage(err.message || 'Restore failed');
    } finally {
      setRestoring(false);
    }
  };

  const handleConfirmRestore = async () => {
    if (!selectedBackupToRestore) return;
    try {
      setRestoring(true);
      await api.restoreBackup({ backupId: selectedBackupToRestore.id });
      setErrorMessage('');
      setSuccessMessage(`Restored from ${selectedBackupToRestore.backup_name}. A safety backup of the previous data was saved. Reloading…`);
      setRestoreModalOpen(false);
      setSelectedBackupToRestore(null);
      setTimeout(() => window.location.reload(), 1500);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to restore snapshot');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Title */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <HardDrive className="w-7 h-7 text-indigo-600" />
            Backup & Disaster Recovery
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Verified copies of the complete database are saved as files on this computer (outside the app folder), automatically and on demand.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleExportJson}
            className="flex items-center gap-2 bg-white hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-xl text-sm font-medium border border-gray-200 shadow-sm transition"
          >
            <Download className="w-4 h-4 text-indigo-600" />
            Export All Data (JSON)
          </button>
        </div>
      </div>

      {successMessage && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-sm flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
          {successMessage}
        </div>
      )}

      {errorMessage && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-sm flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-rose-600 flex-shrink-0" />
          {errorMessage}
        </div>
      )}

      {/* Snapshot Creator Card */}
      <div className="bg-gradient-to-r from-indigo-50/70 to-blue-50/50 rounded-2xl border border-indigo-100 p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-1">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-indigo-600" />
              Create Verified Database Backup
            </h3>
            <p className="text-sm text-gray-600 max-w-xl">
              Copies the entire database (every table) using SQLite's online backup, then checks the copy's integrity. Billing can continue while it runs.
            </p>
          </div>

          <form onSubmit={handleCreateSnapshot} className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              placeholder="e.g. Pre-GST Audit Snapshot"
              value={snapshotName}
              onChange={(e) => setSnapshotName(e.target.value)}
              className="px-4 py-2 border border-gray-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 sm:w-64"
            />
            <button
              type="submit"
              disabled={creating}
              className="flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded-xl text-sm font-medium shadow-sm transition disabled:opacity-50"
            >
              {creating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
              Create Backup
            </button>
          </form>
        </div>
      </div>

      {/* Schedule, folder and restore-from-file */}
      {settings && (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm p-5 space-y-3">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2 text-sm"><Settings2 className="w-4 h-4 text-gray-500" />Automatic Backups</h3>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={settings.autoBackupEnabled} onChange={(e) => setSettings({ ...settings, autoBackupEnabled: e.target.checked })} />
              Back up automatically
            </label>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <label className="space-y-1"><span className="font-semibold text-gray-600">Every (hours)</span>
                <input type="number" min={1} max={168} value={settings.autoBackupIntervalHours} onChange={(e) => setSettings({ ...settings, autoBackupIntervalHours: e.target.value })}
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-lg" /></label>
              <label className="space-y-1"><span className="font-semibold text-gray-600">Keep last (automatic)</span>
                <input type="number" min={1} max={365} value={settings.keepAutoBackups} onChange={(e) => setSettings({ ...settings, keepAutoBackups: e.target.value })}
                  className="w-full px-3 py-1.5 border border-gray-200 rounded-lg" /></label>
            </div>
            <label className="block space-y-1 text-xs"><span className="font-semibold text-gray-600">Backup folder (use a USB / second drive for extra safety)</span>
              <input value={settings.backupDir} onChange={(e) => setSettings({ ...settings, backupDir: e.target.value })} className="w-full px-3 py-1.5 border border-gray-200 rounded-lg font-mono" /></label>
            <p className="text-[11px] text-gray-500">Manual, pre-update and pre-restore backups are never deleted automatically, and the last verified backup is always kept.</p>
            <button onClick={handleSaveSettings} disabled={savingSettings} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50">Save settings</button>
          </div>
          <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm p-5 space-y-3">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2 text-sm"><Upload className="w-4 h-4 text-gray-500" />Restore from a Backup File</h3>
            <p className="text-xs text-gray-600">Choose a <span className="font-mono">.db</span> backup file (for example from a USB drive or another computer). It is integrity-checked before anything changes, and the current data is backed up first.</p>
            <input type="file" accept=".db,.sqlite,.sqlite3,.bak" onChange={(e) => setRestoreFile(e.target.files?.[0] || null)} className="text-xs" />
            <button onClick={handleRestoreFromFile} disabled={!restoreFile || restoring} className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50">Restore from file</button>
          </div>
        </div>
      )}

      {/* Backups Table */}
      <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2 text-sm">
            <Clock className="w-4 h-4 text-gray-500" />
            Backup History ({backups.length})
          </h3>
          <button
            onClick={fetchBackups}
            className="text-xs text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh List
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-gray-600">
            <thead className="bg-gray-50/75 text-gray-700 font-semibold text-xs border-b border-gray-100">
              <tr>
                <th className="py-3 px-4">Backup</th>
                <th className="py-3 px-4">Type / Status</th>
                <th className="py-3 px-4">Size</th>
                <th className="py-3 px-4">Created Date</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-gray-400">Loading snapshots...</td>
                </tr>
              ) : backups.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-gray-400">
                    No snapshots created yet. Click "Create Snapshot" above to take your first backup!
                  </td>
                </tr>
              ) : (
                backups.map((b) => (
                  <tr key={b.id} className="hover:bg-gray-50/50">
                    <td className="py-3.5 px-4 font-medium text-gray-900 flex items-center gap-2">
                      <Database className="w-4 h-4 text-indigo-500 shrink-0" />
                      <span>
                        {b.backup_name}
                        <span className="block text-[10px] font-mono text-gray-400 break-all">{b.file_path}</span>
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-xs">
                      <span className="font-semibold text-gray-700">{b.kind?.replace('_', ' ')}</span>{' '}
                      <span className={`ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${b.status === 'VERIFIED' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>{b.status}</span>
                    </td>
                    <td className="py-3.5 px-4 text-xs text-gray-500">
                      {b.file_size_kb} KB
                    </td>
                    <td className="py-3.5 px-4 text-xs text-gray-500">
                      {new Date(b.created_at.endsWith('Z') ? b.created_at : b.created_at + 'Z').toLocaleString('en-IN')}
                    </td>
                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      <button onClick={() => handleVerify(b)} className="text-xs font-semibold text-gray-600 hover:text-gray-900 px-2 py-1.5">Verify</button>
                      <button onClick={() => handleDelete(b)} className="text-gray-400 hover:text-rose-600 px-2 py-1.5" title="Delete backup file"><Trash2 className="w-3.5 h-3.5 inline" /></button>
                      <button
                        disabled={b.status === 'MISSING' || b.status === 'FAILED'}
                        onClick={() => {
                          setSelectedBackupToRestore(b);
                          setRestoreModalOpen(true);
                        }}
                        className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition"
                      >
                        Restore
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Restore Confirmation Modal */}
      {restoreModalOpen && selectedBackupToRestore && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center gap-3 text-amber-600">
              <AlertTriangle className="w-6 h-6 flex-shrink-0" />
              <h3 className="text-lg font-bold text-gray-900">Confirm Database Restore</h3>
            </div>

            <p className="text-sm text-gray-600 leading-relaxed">
              Are you sure you want to restore to snapshot: <strong className="text-gray-900">{selectedBackupToRestore.backup_name}</strong>?
              All business data is replaced in a single transaction. A safety backup of the current data is created first, so this can be undone.
            </p>

            <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-800">
              Backup taken: {new Date(selectedBackupToRestore.created_at + 'Z').toLocaleString('en-IN')}
            </div>

            <div className="flex justify-end gap-3 pt-3">
              <button
                type="button"
                onClick={() => setRestoreModalOpen(false)}
                className="px-4 py-2 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={restoring}
                onClick={handleConfirmRestore}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded-xl text-sm font-medium shadow-sm transition disabled:opacity-50"
              >
                {restoring && <RefreshCw className="w-4 h-4 animate-spin" />}
                Confirm & Restore
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
