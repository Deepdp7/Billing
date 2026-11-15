import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { 
  ShieldAlert, 
  Search, 
  Clock, 
  UserCheck, 
  FileCode, 
  RefreshCw,
  Filter
} from 'lucide-react';
import { Select } from '../../components/ui/Select.js';

import { useLiveRefresh } from '../../lib/live.js';
export const AuditLogsPage: React.FC = () => {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('ALL');

  useEffect(() => {
    fetchLogs();
  }, []);

  // Another computer of this account changed something: the lists reload quietly
  useLiveRefresh(() => { void fetchLogs(true); });
  const fetchLogs = async (quiet?: unknown) => {
    try {
      if (quiet !== true) setLoading(true);
      const res = await api.getAuditLogs();
      setLogs(res.logs);
    } catch (err) {
      console.error('Failed to load audit logs', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredLogs = logs.filter(log => {
    const matchesSearch = 
      log.action.toLowerCase().includes(search.toLowerCase()) ||
      log.entity_type.toLowerCase().includes(search.toLowerCase()) ||
      (log.user_name && log.user_name.toLowerCase().includes(search.toLowerCase())) ||
      (log.details_json && log.details_json.toLowerCase().includes(search.toLowerCase()));
    
    const matchesAction = actionFilter === 'ALL' || log.action === actionFilter;
    return matchesSearch && matchesAction;
  });

  const uniqueActions = Array.from(new Set(logs.map(l => l.action)));

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white font-['Outfit'] flex items-center gap-2">
            <ShieldAlert className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
            Security & Audit Activity Logs
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Immutable system logs tracking financial changes, stock alterations, logins, and administrative actions.
          </p>
        </div>

        <button
          onClick={fetchLogs}
          className="flex items-center gap-2 bg-white dark:bg-slate-900 dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 px-3.5 py-2 rounded-xl text-sm font-medium border border-slate-200 dark:border-slate-700 shadow-sm transition"
        >
          <RefreshCw className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          Refresh Activity
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by action, user, or details..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-xl text-sm bg-white dark:bg-slate-900 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
          />
        </div>

        <div className="sm:w-60">
          <Select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="w-full px-3 py-2 rounded-xl text-sm bg-white dark:bg-slate-900 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
          >
            <option value="ALL">All Actions ({logs.length})</option>
            {uniqueActions.map(action => (
              <option key={action} value={action}>{action}</option>
            ))}
          </Select>
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-200 font-semibold text-xs border-b border-slate-100 dark:border-slate-800">
              <tr>
                <th className="py-3 px-4">Action Event</th>
                <th className="py-3 px-4">Entity</th>
                <th className="py-3 px-4">Performed By</th>
                <th className="py-3 px-4">Details JSON</th>
                <th className="py-3 px-4">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-400 dark:text-slate-500">Loading audit trail...</td>
                </tr>
              ) : filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-400 dark:text-slate-500">
                    No activity logs recorded matching criteria.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="py-3.5 px-4 font-semibold text-slate-900 dark:text-slate-100 text-xs">
                      <span className="bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded-md font-mono">
                        {log.action}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-xs font-mono text-slate-600 dark:text-slate-300">
                      {log.entity_type}
                    </td>
                    <td className="py-3.5 px-4 text-xs text-slate-800 dark:text-slate-100">
                      <div className="font-medium">{log.user_name || 'System Operator'}</div>
                      <div className="text-[10px] text-slate-400 dark:text-slate-500">{log.user_email || 'automated'}</div>
                    </td>
                    <td className="py-3.5 px-4 font-mono text-[11px] text-slate-500 dark:text-slate-400 max-w-xs truncate">
                      {log.details_json}
                    </td>
                    <td className="py-3.5 px-4 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString('en-IN')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
