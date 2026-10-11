import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api.js';
import { 
  ServiceAppointment, ServiceRecord, RecurringInvoice, HardwareSettings, Customer 
} from '../../types/index.js';
import { useLanguage } from '../../context/LanguageContext.js';
import { 
  Wrench, Calendar, ClipboardList, Repeat, Printer, MessageSquare, 
  Plus, Search, RefreshCw, CheckCircle2, AlertCircle, Clock, 
  Smartphone, Scale, Cpu, Check, X, ChevronRight, User, Phone
} from 'lucide-react';

export const ServiceBusinessPage: React.FC = () => {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<'appointments' | 'jobCards' | 'recurring' | 'hardware'>('appointments');
  const [appointments, setAppointments] = useState<ServiceAppointment[]>([]);
  const [jobCards, setJobCards] = useState<ServiceRecord[]>([]);
  const [recurringInvoices, setRecurringInvoices] = useState<RecurringInvoice[]>([]);
  const [hardwareSettings, setHardwareSettings] = useState<HardwareSettings | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Modals
  const [showAddAptModal, setShowAddAptModal] = useState(false);
  const [aptForm, setAptForm] = useState({
    customerName: '',
    customerPhone: '',
    serviceName: 'Full Comprehensive Servicing',
    staffName: 'Vinay Technician',
    appointmentDate: new Date().toISOString().split('T')[0],
    appointmentTime: '10:30 AM',
    estimatedCost: 2500,
    notes: 'Customer requested quick turnaround',
  });

  const [showAddJobModal, setShowAddJobModal] = useState(false);
  const [jobForm, setJobForm] = useState({
    customerName: '',
    customerPhone: '',
    assetItemName: 'Dell XPS 15 Laptop',
    serialOrRegNumber: 'DL-SN-99881',
    issueReported: 'Display flickering and thermal throttling under load',
    diagnosisNotes: 'Dust accumulated in cooling fan; thermal paste dried out',
    partsCost: 850,
    laborCost: 1200,
    assignedTechnician: 'Vinay Technician',
  });

  const [showAddRecModal, setShowAddRecModal] = useState(false);
  const [recForm, setRecForm] = useState({
    customerId: '',
    customerName: '',
    frequency: 'MONTHLY' as any,
    amount: 5000,
    description: 'Monthly Maintenance & IT Retainer Contract',
    nextRunDate: new Date().toISOString().split('T')[0],
  });

  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [aptRes, jobRes, recRes, hwRes, custRes, sumRes] = await Promise.all([
        api.getAppointments(),
        api.getJobCards(),
        api.getRecurringInvoices(),
        api.getHardwareSettings(),
        api.getCustomers(),
        api.getServiceSummary(),
      ]);

      const customersList = (custRes as any).data || (custRes as any).customers || [];

      setAppointments(aptRes.appointments || []);
      setJobCards(jobRes.jobCards || []);
      setRecurringInvoices(recRes.recurringInvoices || []);
      setHardwareSettings(hwRes.settings || null);
      setCustomers(customersList);
      setSummary(sumRes.summary || null);

      if (customersList && customersList.length > 0) {
        setRecForm(prev => ({
          ...prev,
          customerId: customersList[0].id,
          customerName: customersList[0].name,
        }));
      }
    } catch (err: any) {
      setNotification({ type: 'error', message: err.message || 'Failed to load service records' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCreateAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.createAppointment(aptForm);
      setNotification({ type: 'success', message: 'Appointment successfully booked!' });
      setShowAddAptModal(false);
      fetchData();
      setTimeout(() => setNotification(null), 3500);
    } catch (err: any) {
      setNotification({ type: 'error', message: err.message || 'Failed to book appointment' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateAptStatus = async (id: string, status: string) => {
    try {
      await api.updateAppointmentStatus(id, status);
      setNotification({ type: 'success', message: `Appointment status set to ${status}` });
      fetchData();
      setTimeout(() => setNotification(null), 3000);
    } catch (err: any) {
      setNotification({ type: 'error', message: err.message || 'Failed to update status' });
    }
  };

  const handleCreateJobCard = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.createJobCard(jobForm);
      setNotification({ type: 'success', message: 'New Job Card issued!' });
      setShowAddJobModal(false);
      fetchData();
      setTimeout(() => setNotification(null), 3500);
    } catch (err: any) {
      setNotification({ type: 'error', message: err.message || 'Failed to issue job card' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateJobStatus = async (id: string, status: string) => {
    try {
      await api.updateJobCard(id, { status });
      setNotification({ type: 'success', message: `Job Card updated to ${status}` });
      fetchData();
      setTimeout(() => setNotification(null), 3000);
    } catch (err: any) {
      setNotification({ type: 'error', message: err.message || 'Failed to update job card' });
    }
  };

  const handleCreateRecurring = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.createRecurringInvoice(recForm);
      setNotification({ type: 'success', message: 'Recurring contract setup completed!' });
      setShowAddRecModal(false);
      fetchData();
      setTimeout(() => setNotification(null), 3500);
    } catch (err: any) {
      setNotification({ type: 'error', message: err.message || 'Failed to setup retainer' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveHardwareSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hardwareSettings) return;
    setSubmitting(true);
    try {
      await api.updateHardwareSettings(hardwareSettings);
      setNotification({ type: 'success', message: 'Hardware & Gateway configuration saved!' });
      setTimeout(() => setNotification(null), 3500);
    } catch (err: any) {
      setNotification({ type: 'error', message: err.message || 'Failed to save hardware settings' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Toast Notification */}
      {notification && (
        <div
          className={`p-4 rounded-xl flex items-center justify-between text-sm shadow-lg border transition-all ${
            notification.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800'
              : 'bg-rose-50 dark:bg-rose-950/80 text-rose-800 dark:text-rose-200 border-rose-200 dark:border-rose-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {notification.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400" />
            )}
            <span className="font-medium">{notification.message}</span>
          </div>
          <button onClick={() => setNotification(null)} className="text-xs uppercase font-bold tracking-wider opacity-70">
            Dismiss
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-cyan-600 to-teal-500 flex items-center justify-center text-white shadow-lg shadow-cyan-500/30">
            <Wrench className="w-7 h-7 fill-white" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
              Service Businesses & Hardware Gateway
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              PRD §5 Services Vertical · Appointments, Job Cards, Retainers & ESC/POS Printers
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => fetchData()}
            className="flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>{t('refresh', 'Refresh')}</span>
          </button>

          {activeTab === 'appointments' && (
            <button
              onClick={() => setShowAddAptModal(true)}
              className="flex items-center gap-2 px-3.5 py-2 text-xs font-bold rounded-xl bg-cyan-600 hover:bg-cyan-700 text-white shadow-md shadow-cyan-600/25 transition"
            >
              <Plus className="w-4 h-4" />
              <span>Book Appointment</span>
            </button>
          )}

          {activeTab === 'jobCards' && (
            <button
              onClick={() => setShowAddJobModal(true)}
              className="flex items-center gap-2 px-3.5 py-2 text-xs font-bold rounded-xl bg-cyan-600 hover:bg-cyan-700 text-white shadow-md shadow-cyan-600/25 transition"
            >
              <Plus className="w-4 h-4" />
              <span>New Job Card</span>
            </button>
          )}

          {activeTab === 'recurring' && (
            <button
              onClick={() => setShowAddRecModal(true)}
              className="flex items-center gap-2 px-3.5 py-2 text-xs font-bold rounded-xl bg-cyan-600 hover:bg-cyan-700 text-white shadow-md shadow-cyan-600/25 transition"
            >
              <Plus className="w-4 h-4" />
              <span>Setup Retainer Contract</span>
            </button>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Appointments Today</span>
            <Calendar className="w-4 h-4 text-cyan-500" />
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white">
            {summary?.appointmentsToday ?? appointments.length} <span className="text-xs font-medium text-slate-400">Scheduled</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Client bookings for today</p>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Active Job Cards</span>
            <ClipboardList className="w-4 h-4 text-teal-500" />
          </div>
          <div className="text-2xl font-black text-teal-600 dark:text-teal-400">
            {summary?.activeJobCards ?? jobCards.filter(j => j.status !== 'DELIVERED').length} <span className="text-xs font-medium text-slate-400">In Workshop</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Pending repairs & servicing</p>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Active Retainers</span>
            <Repeat className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="text-2xl font-black text-indigo-600 dark:text-indigo-400">
            {recurringInvoices.length} <span className="text-xs font-medium text-slate-400">Contracts</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Automated recurring billing</p>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Monthly MRR Value</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400">
            ₹{(summary?.monthlyRecurringRevenue ?? 12000).toLocaleString('en-IN')}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Guaranteed monthly recurring revenue</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800">
        <button
          onClick={() => setActiveTab('appointments')}
          className={`flex items-center gap-2 px-4 py-3 text-xs font-bold border-b-2 transition ${
            activeTab === 'appointments'
              ? 'border-cyan-600 text-cyan-600 dark:text-cyan-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <Calendar className="w-4 h-4" />
          <span>Appointments & Scheduling ({appointments.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('jobCards')}
          className={`flex items-center gap-2 px-4 py-3 text-xs font-bold border-b-2 transition ${
            activeTab === 'jobCards'
              ? 'border-cyan-600 text-cyan-600 dark:text-cyan-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <ClipboardList className="w-4 h-4" />
          <span>Job Cards & Service Records ({jobCards.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('recurring')}
          className={`flex items-center gap-2 px-4 py-3 text-xs font-bold border-b-2 transition ${
            activeTab === 'recurring'
              ? 'border-cyan-600 text-cyan-600 dark:text-cyan-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <Repeat className="w-4 h-4" />
          <span>Recurring Retainers ({recurringInvoices.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('hardware')}
          className={`flex items-center gap-2 px-4 py-3 text-xs font-bold border-b-2 transition ${
            activeTab === 'hardware'
              ? 'border-cyan-600 text-cyan-600 dark:text-cyan-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <Printer className="w-4 h-4" />
          <span>Hardware & SMS Gateway Config</span>
        </button>
      </div>

      {/* TAB 1: Appointments */}
      {activeTab === 'appointments' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <h2 className="font-bold text-sm text-slate-900 dark:text-white">
              Client Appointment Bookings
            </h2>
            <span className="text-xs text-slate-400">{appointments.length} active sessions</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider text-[10px] border-b border-slate-100 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3">Client Name</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">Service Requested</th>
                  <th className="px-4 py-3">Date & Time</th>
                  <th className="px-4 py-3">Assigned Staff</th>
                  <th className="px-4 py-3 text-right">Est. Cost</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {appointments.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                      No appointments scheduled. Click "Book Appointment" to schedule client sessions.
                    </td>
                  </tr>
                ) : (
                  appointments.map((apt) => (
                    <tr key={apt.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition">
                      <td className="px-4 py-3 font-semibold text-slate-900 dark:text-white">
                        {apt.customerName}
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-500">
                        {apt.customerPhone}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-700 dark:text-slate-300">
                        {apt.serviceName}
                      </td>
                      <td className="px-4 py-3 text-slate-500 font-mono text-[11px]">
                        {apt.appointmentDate} · {apt.appointmentTime}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                        {apt.staffName || 'Any Available'}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-slate-900 dark:text-white">
                        ₹{apt.estimatedCost.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                          apt.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-800' :
                          apt.status === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-800' :
                          apt.status === 'CANCELLED' ? 'bg-rose-100 text-rose-800' :
                          'bg-amber-100 text-amber-800'
                        }`}>
                          {apt.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right space-x-1">
                        {apt.status !== 'COMPLETED' && (
                          <button
                            onClick={() => handleUpdateAptStatus(apt.id, 'COMPLETED')}
                            className="px-2 py-1 text-[10px] font-bold rounded bg-emerald-600 text-white hover:bg-emerald-700"
                          >
                            Complete
                          </button>
                        )}
                        {apt.status === 'SCHEDULED' && (
                          <button
                            onClick={() => handleUpdateAptStatus(apt.id, 'CANCELLED')}
                            className="px-2 py-1 text-[10px] font-bold rounded bg-slate-200 text-slate-700 hover:bg-rose-600 hover:text-white"
                          >
                            Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: Job Cards */}
      {activeTab === 'jobCards' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <h2 className="font-bold text-sm text-slate-900 dark:text-white">
              Service Job Cards & Workshop Work Orders
            </h2>
            <span className="text-xs text-slate-400">{jobCards.length} records</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider text-[10px] border-b border-slate-100 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3">Job Card #</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Asset / Item</th>
                  <th className="px-4 py-3">Issue Reported</th>
                  <th className="px-4 py-3 text-right">Parts</th>
                  <th className="px-4 py-3 text-right">Labor</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {jobCards.map((job) => (
                  <tr key={job.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition">
                    <td className="px-4 py-3 font-mono font-bold text-cyan-600 dark:text-cyan-400">
                      {job.jobCardNumber}
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-900 dark:text-white">
                      {job.customerName}
                    </td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                      {job.assetItemName} {job.serialOrRegNumber ? `(${job.serialOrRegNumber})` : ''}
                    </td>
                    <td className="px-4 py-3 text-slate-500 truncate max-w-xs">
                      {job.issueReported}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-500">
                      ₹{job.partsCost.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-500">
                      ₹{job.laborCost.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right font-black text-slate-900 dark:text-white">
                      ₹{job.totalCost.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase ${
                        job.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-800' :
                        job.status === 'DELIVERED' ? 'bg-teal-100 text-teal-800' :
                        job.status === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-800' :
                        'bg-amber-100 text-amber-800'
                      }`}>
                        {job.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right space-x-1">
                      {job.status !== 'DELIVERED' && (
                        <button
                          onClick={() => handleUpdateJobStatus(job.id, 'DELIVERED')}
                          className="px-2 py-1 text-[10px] font-bold rounded bg-teal-600 text-white hover:bg-teal-700"
                        >
                          Mark Delivered
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: Recurring Retainers */}
      {activeTab === 'recurring' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <h2 className="font-bold text-sm text-slate-900 dark:text-white">
              Recurring Retainers & Maintenance Contracts
            </h2>
            <span className="text-xs text-slate-400">Automated Billing Runs</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider text-[10px] border-b border-slate-100 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">Contract Description</th>
                  <th className="px-4 py-3">Frequency</th>
                  <th className="px-4 py-3 text-right">Retainer Amount</th>
                  <th className="px-4 py-3">Next Invoicing Date</th>
                  <th className="px-4 py-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {recurringInvoices.map((rec) => (
                  <tr key={rec.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition">
                    <td className="px-4 py-3 font-semibold text-slate-900 dark:text-white">
                      {rec.customerName}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {rec.description}
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                        {rec.frequency}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-black text-emerald-600 dark:text-emerald-400">
                      ₹{rec.amount.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-500">
                      {rec.nextRunDate}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-800">
                        {rec.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: Hardware & SMS Gateway Settings */}
      {activeTab === 'hardware' && hardwareSettings && (
        <form onSubmit={handleSaveHardwareSettings} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* ESC/POS Thermal Printer Settings */}
            <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
              <div className="flex items-center gap-2 text-slate-900 dark:text-white font-bold text-sm border-b pb-3 border-slate-100 dark:border-slate-800">
                <Printer className="w-5 h-5 text-cyan-600" />
                <span>ESC/POS Thermal Receipt Printer Settings</span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Printer Paper Width
                </label>
                <select
                  value={hardwareSettings.printerType}
                  onChange={(e: any) => setHardwareSettings({ ...hardwareSettings, printerType: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                >
                  <option value="THERMAL_80MM">80mm Standard POS Thermal Receipt (3-inch)</option>
                  <option value="THERMAL_58MM">58mm Compact POS Thermal Receipt (2-inch)</option>
                  <option value="LASER_A4">Standard A4 / Laser Jet Page</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Printer Interface Mode
                </label>
                <select
                  value={hardwareSettings.printerInterface}
                  onChange={(e: any) => setHardwareSettings({ ...hardwareSettings, printerInterface: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                >
                  <option value="BROWSER_POPUP">Direct Browser Print Engine (Recommended)</option>
                  <option value="RAW_BT">RawBT Thermal Service (Android / Mobile USB/BT)</option>
                  <option value="NETWORK_ESC_POS">Network TCP/IP ESC/POS Port 9100</option>
                </select>
              </div>

              <div className="space-y-2 pt-2">
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hardwareSettings.autoCutPaper}
                    onChange={(e) => setHardwareSettings({ ...hardwareSettings, autoCutPaper: e.target.checked })}
                    className="w-4 h-4 rounded text-cyan-600"
                  />
                  <span>Send ESC/POS GS V 66 Auto Paper Cut command</span>
                </label>

                <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hardwareSettings.openCashDrawer}
                    onChange={(e) => setHardwareSettings({ ...hardwareSettings, openCashDrawer: e.target.checked })}
                    className="w-4 h-4 rounded text-cyan-600"
                  />
                  <span>Send ESC p 0 25 250 Cash Drawer Kick command on invoice print</span>
                </label>
              </div>
            </div>

            {/* Weighing Scale Integration */}
            <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
              <div className="flex items-center gap-2 text-slate-900 dark:text-white font-bold text-sm border-b pb-3 border-slate-100 dark:border-slate-800">
                <Scale className="w-5 h-5 text-teal-600" />
                <span>Weighing Scale Serial COM Port Config</span>
              </div>

              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hardwareSettings.weighingScaleEnabled}
                  onChange={(e) => setHardwareSettings({ ...hardwareSettings, weighingScaleEnabled: e.target.checked })}
                  className="w-4 h-4 rounded text-teal-600"
                />
                <span>Enable Electronic Weighing Scale Auto-Capture</span>
              </label>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Serial COM Baud Rate
                </label>
                <select
                  value={hardwareSettings.weighingScaleBaudRate}
                  onChange={(e) => setHardwareSettings({ ...hardwareSettings, weighingScaleBaudRate: Number(e.target.value) })}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                >
                  <option value={9600}>9600 bps (Standard Indian Scales)</option>
                  <option value={4800}>4800 bps</option>
                  <option value={19200}>19200 bps</option>
                </select>
                <p className="text-[11px] text-slate-400 mt-1">
                  Supports Avery Berkel, Essae, Eagle, and Phoenix serial protocols via Web Serial API.
                </p>
              </div>
            </div>

            {/* Third-party SMS & WhatsApp Gateway */}
            <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4 md:col-span-2">
              <div className="flex items-center gap-2 text-slate-900 dark:text-white font-bold text-sm border-b pb-3 border-slate-100 dark:border-slate-800">
                <MessageSquare className="w-5 h-5 text-indigo-600" />
                <span>Customer SMS & WhatsApp Dispatch Gateway</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Gateway Provider
                  </label>
                  <select
                    value={hardwareSettings.smsGatewayProvider}
                    onChange={(e: any) => setHardwareSettings({ ...hardwareSettings, smsGatewayProvider: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                  >
                    <option value="WHATSAPP_DIRECT">Direct WhatsApp App / Web (Zero-Cost)</option>
                    <option value="TWILIO">Twilio SMS Gateway API</option>
                    <option value="FAST2SMS">Fast2SMS Indian DLT Route</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    API Key / Secret Token
                  </label>
                  <input
                    type="password"
                    placeholder="Enter Provider API Key"
                    value={hardwareSettings.smsApiKey || ''}
                    onChange={(e) => setHardwareSettings({ ...hardwareSettings, smsApiKey: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Sender ID / Header
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. APNABL"
                    value={hardwareSettings.smsSenderId || ''}
                    onChange={(e) => setHardwareSettings({ ...hardwareSettings, smsSenderId: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hardwareSettings.autoSendBillSms}
                    onChange={(e) => setHardwareSettings({ ...hardwareSettings, autoSendBillSms: e.target.checked })}
                    className="w-4 h-4 rounded text-indigo-600"
                  />
                  <span>Auto-dispatch WhatsApp invoice copy when POS Bill is printed</span>
                </label>

                <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hardwareSettings.autoSendAppointmentSms}
                    onChange={(e) => setHardwareSettings({ ...hardwareSettings, autoSendAppointmentSms: e.target.checked })}
                    className="w-4 h-4 rounded text-indigo-600"
                  />
                  <span>Auto-send reminder SMS 2 hours before scheduled appointment</span>
                </label>
              </div>

              <div className="flex justify-end pt-3">
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-6 py-2.5 text-xs font-bold rounded-xl bg-cyan-600 hover:bg-cyan-700 text-white shadow-md shadow-cyan-600/25 transition"
                >
                  Save Hardware & Gateway Preferences
                </button>
              </div>
            </div>
          </div>
        </form>
      )}

      {/* Book Appointment Modal */}
      {showAddAptModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-md w-full p-6 animate-scaleIn">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-white">
                Book Client Appointment
              </h3>
              <button onClick={() => setShowAddAptModal(false)} className="text-slate-400 hover:text-slate-600 font-bold">
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateAppointment} className="space-y-3 mt-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Client Name
                  </label>
                  <input
                    type="text"
                    value={aptForm.customerName}
                    onChange={(e) => setAptForm({ ...aptForm, customerName: e.target.value })}
                    placeholder="e.g. Ramesh Patel"
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                    required
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Phone Number
                  </label>
                  <input
                    type="tel"
                    value={aptForm.customerPhone}
                    onChange={(e) => setAptForm({ ...aptForm, customerPhone: e.target.value })}
                    placeholder="10-digit mobile"
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Service Requested
                </label>
                <input
                  type="text"
                  value={aptForm.serviceName}
                  onChange={(e) => setAptForm({ ...aptForm, serviceName: e.target.value })}
                  placeholder="e.g. Car Diagnostics / Hair Styling"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Date
                  </label>
                  <input
                    type="date"
                    value={aptForm.appointmentDate}
                    onChange={(e) => setAptForm({ ...aptForm, appointmentDate: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                    required
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Time
                  </label>
                  <input
                    type="text"
                    value={aptForm.appointmentTime}
                    onChange={(e) => setAptForm({ ...aptForm, appointmentTime: e.target.value })}
                    placeholder="e.g. 11:30 AM"
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Technician / Staff
                  </label>
                  <input
                    type="text"
                    value={aptForm.staffName}
                    onChange={(e) => setAptForm({ ...aptForm, staffName: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Estimated Cost (₹)
                  </label>
                  <input
                    type="number"
                    value={aptForm.estimatedCost}
                    onChange={(e) => setAptForm({ ...aptForm, estimatedCost: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-bold"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddAptModal(false)}
                  className="px-4 py-2 font-semibold rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 font-bold rounded-xl bg-cyan-600 hover:bg-cyan-700 text-white shadow-md transition"
                >
                  Book Session
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New Job Card Modal */}
      {showAddJobModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-lg w-full p-6 animate-scaleIn">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-white">
                Issue Workshop Job Card
              </h3>
              <button onClick={() => setShowAddJobModal(false)} className="text-slate-400 hover:text-slate-600 font-bold">
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateJobCard} className="space-y-3 mt-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Customer Name
                  </label>
                  <input
                    type="text"
                    value={jobForm.customerName}
                    onChange={(e) => setJobForm({ ...jobForm, customerName: e.target.value })}
                    placeholder="Customer Name"
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                    required
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Customer Phone
                  </label>
                  <input
                    type="tel"
                    value={jobForm.customerPhone}
                    onChange={(e) => setJobForm({ ...jobForm, customerPhone: e.target.value })}
                    placeholder="Phone number"
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Item / Asset Name
                  </label>
                  <input
                    type="text"
                    value={jobForm.assetItemName}
                    onChange={(e) => setJobForm({ ...jobForm, assetItemName: e.target.value })}
                    placeholder="e.g. Royal Enfield Classic 350"
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                    required
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Serial / Reg Number
                  </label>
                  <input
                    type="text"
                    value={jobForm.serialOrRegNumber}
                    onChange={(e) => setJobForm({ ...jobForm, serialOrRegNumber: e.target.value })}
                    placeholder="e.g. MH02-BK-4421"
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Issue / Fault Reported
                </label>
                <textarea
                  rows={2}
                  value={jobForm.issueReported}
                  onChange={(e) => setJobForm({ ...jobForm, issueReported: e.target.value })}
                  placeholder="Detailed customer complaint"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Parts Cost (₹)
                  </label>
                  <input
                    type="number"
                    value={jobForm.partsCost}
                    onChange={(e) => setJobForm({ ...jobForm, partsCost: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Labor / Service Charge (₹)
                  </label>
                  <input
                    type="number"
                    value={jobForm.laborCost}
                    onChange={(e) => setJobForm({ ...jobForm, laborCost: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddJobModal(false)}
                  className="px-4 py-2 font-semibold rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 font-bold rounded-xl bg-cyan-600 hover:bg-cyan-700 text-white shadow-md transition"
                >
                  Generate Job Card
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Setup Retainer Modal */}
      {showAddRecModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-md w-full p-6 animate-scaleIn">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-white">
                Setup Recurring Contract Retainer
              </h3>
              <button onClick={() => setShowAddRecModal(false)} className="text-slate-400 hover:text-slate-600 font-bold">
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateRecurring} className="space-y-3 mt-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Customer / Client
                </label>
                <select
                  value={recForm.customerId}
                  onChange={(e) => {
                    const cid = e.target.value;
                    const c = customers.find(x => x.id === cid);
                    setRecForm({ ...recForm, customerId: cid, customerName: c?.name || '' });
                  }}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                  required
                >
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Contract Description
                </label>
                <input
                  type="text"
                  value={recForm.description}
                  onChange={(e) => setRecForm({ ...recForm, description: e.target.value })}
                  placeholder="e.g. Monthly IT Cloud Support"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Billing Cycle
                  </label>
                  <select
                    value={recForm.frequency}
                    onChange={(e: any) => setRecForm({ ...recForm, frequency: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                  >
                    <option value="MONTHLY">Monthly</option>
                    <option value="QUARTERLY">Quarterly</option>
                    <option value="ANNUAL">Annual</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Retainer Amount (₹)
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={recForm.amount}
                    onChange={(e) => setRecForm({ ...recForm, amount: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-bold"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Next Invoicing Date
                </label>
                <input
                  type="date"
                  value={recForm.nextRunDate}
                  onChange={(e) => setRecForm({ ...recForm, nextRunDate: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddRecModal(false)}
                  className="px-4 py-2 font-semibold rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 font-bold rounded-xl bg-cyan-600 hover:bg-cyan-700 text-white shadow-md transition"
                >
                  Activate Contract
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
