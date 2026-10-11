import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { 
  Database, 
  Download, 
  Upload, 
  ShieldCheck, 
  Clock, 
  CheckCircle2, 
  AlertTriangle,
  RefreshCw,
  HardDrive
} from 'lucide-react';

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

  useEffect(() => {
    fetchBackups();
  }, []);

  const fetchBackups = async () => {
    try {
      setLoading(true);
      const res = await api.getBackups();
      setBackups(res.backups);
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
      setSuccessMessage('Database backup snapshot created successfully!');
      setSnapshotName('');
      fetchBackups();
      setTimeout(() => setSuccessMessage(''), 4000);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to create backup');
    } finally {
      setCreating(false);
    }
  };

  const handleExportJson = () => {
    const token = localStorage.getItem('apna_billing_token');
    window.open(`/api/v1/app/backups/export?token=${token}`, '_blank');
  };

  const handleConfirmRestore = async () => {
    if (!selectedBackupToRestore) return;
    try {
      setRestoring(true);
      await api.restoreBackup({ backupId: selectedBackupToRestore.id });
      setSuccessMessage(`Successfully restored snapshot: ${selectedBackupToRestore.backup_name}`);
      setRestoreModalOpen(false);
      setSelectedBackupToRestore(null);
      setTimeout(() => setSuccessMessage(''), 5000);
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
            Safeguard your entire store database, products, invoices, and ledgers with 1-click cloud snapshots and offline JSON exports.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleExportJson}
            className="flex items-center gap-2 bg-white hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-xl text-sm font-medium border border-gray-200 shadow-sm transition"
          >
            <Download className="w-4 h-4 text-indigo-600" />
            Download Full JSON Backup
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
              Create Point-in-Time Database Snapshot
            </h3>
            <p className="text-sm text-gray-600 max-w-xl">
              Captures all active products, invoices, customers, and financial ledger transactions in an instant transactional restore point.
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
              Create Snapshot
            </button>
          </form>
        </div>
      </div>

      {/* Backups Table */}
      <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2 text-sm">
            <Clock className="w-4 h-4 text-gray-500" />
            Snapshot History ({backups.length})
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
                <th className="py-3 px-4">Snapshot Name</th>
                <th className="py-3 px-4">Records Included</th>
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
                      <Database className="w-4 h-4 text-indigo-500" />
                      {b.backup_name}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-xs text-gray-700">
                      {b.record_count} items
                    </td>
                    <td className="py-3.5 px-4 text-xs text-gray-500">
                      {b.file_size_kb} KB
                    </td>
                    <td className="py-3.5 px-4 text-xs text-gray-500">
                      {new Date(b.created_at).toLocaleString('en-IN')}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <button
                        onClick={() => {
                          setSelectedBackupToRestore(b);
                          setRestoreModalOpen(true);
                        }}
                        className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition"
                      >
                        Restore Point
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
              This operation executes inside an atomic ACID transaction.
            </p>

            <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-800">
              Snapshot timestamp: {new Date(selectedBackupToRestore.created_at).toLocaleString('en-IN')}
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
