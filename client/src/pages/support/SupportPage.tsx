import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { 
  HelpCircle, 
  LifeBuoy, 
  MessageSquare, 
  Search, 
  Plus, 
  ChevronDown, 
  ChevronUp, 
  CheckCircle2, 
  Clock, 
  AlertCircle,
  FileText
} from 'lucide-react';
import { Select } from '../../components/ui/Select.js';

import { useLiveRefresh } from '../../lib/live.js';
export const SupportPage: React.FC = () => {
  const [faqs, setFaqs] = useState<any[]>([]);
  const [tickets, setTickets] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'faqs' | 'tickets'>('faqs');
  const [openFaqId, setOpenFaqId] = useState<string | null>('faq-1');
  const [loading, setLoading] = useState(true);
  
  // Ticket Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  // Another computer of this account changed something: the lists reload quietly
  useLiveRefresh(() => { void loadData(true); });
  const loadData = async (quiet?: unknown) => {
    try {
      if (quiet !== true) setLoading(true);
      const [faqRes, ticketRes] = await Promise.all([
        api.getSupportFaqs(),
        api.getSupportTickets(),
      ]);
      setFaqs(faqRes.faqs);
      setTickets(ticketRes.tickets);
    } catch (err) {
      console.error('Failed to load support data', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject || !description) return;
    try {
      setSubmitting(true);
      await api.createSupportTicket({ subject, description, priority });
      setSuccessMsg('Support ticket submitted! Our platform engineers will review it shortly.');
      setIsModalOpen(false);
      setSubject('');
      setDescription('');
      loadData();
      setActiveTab('tickets');
      setTimeout(() => setSuccessMsg(''), 5000);
    } catch (err) {
      console.error('Failed to create ticket', err);
    } finally {
      setSubmitting(false);
    }
  };

  const filteredFaqs = faqs.filter(f => 
    f.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
    f.answer.toLowerCase().includes(searchQuery.toLowerCase()) ||
    f.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Page Title */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white font-['Outfit'] flex items-center gap-2">
            <LifeBuoy className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
            Help Center & Support Desk
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Browse knowledgebase guides or submit a support ticket directly to our platform support team.
          </p>
        </div>

        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 btn-brand px-4 py-2 rounded-xl text-sm font-medium shadow-sm transition"
        >
          <Plus className="w-4 h-4" />
          Raise Support Ticket
        </button>
      </div>

      {successMsg && (
        <div className="p-4 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-200 rounded-xl text-sm flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
          {successMsg}
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-700 pb-2">
        <button
          onClick={() => setActiveTab('faqs')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition ${
            activeTab === 'faqs'
              ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-500/30'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
          }`}
        >
          <HelpCircle className="w-4 h-4" />
          Knowledgebase & Guides ({faqs.length})
        </button>
        <button
          onClick={() => setActiveTab('tickets')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition ${
            activeTab === 'tickets'
              ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-500/30'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
          }`}
        >
          <MessageSquare className="w-4 h-4" />
          My Support Tickets ({tickets.length})
        </button>
      </div>

      {activeTab === 'faqs' && (
        <div className="space-y-4">
          {/* Search bar */}
          <div className="relative max-w-xl">
            <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search guides (e.g. GST split, Thermal printer, Barcode)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm bg-white dark:bg-slate-900 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            />
          </div>

          {/* Accordion */}
          <div className="space-y-3">
            {filteredFaqs.map((faq) => (
              <div
                key={faq.id}
                className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => setOpenFaqId(openFaqId === faq.id ? null : faq.id)}
                  className="w-full p-4 text-left flex items-center justify-between gap-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition"
                >
                  <div className="space-y-1">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-2 py-0.5 rounded-md">
                      {faq.category}
                    </span>
                    <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-sm">
                      {faq.question}
                    </h3>
                  </div>
                  {openFaqId === faq.id ? (
                    <ChevronUp className="w-4 h-4 text-slate-400 dark:text-slate-500" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-400 dark:text-slate-500" />
                  )}
                </button>

                {openFaqId === faq.id && (
                  <div className="px-4 pb-4 pt-1 text-sm text-slate-600 dark:text-slate-300 border-t border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 leading-relaxed">
                    {faq.answer}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'tickets' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-200 font-semibold text-xs border-b border-slate-100 dark:border-slate-800">
                <tr>
                  <th className="py-3 px-4">Subject</th>
                  <th className="py-3 px-4">Priority</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Submitted Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {tickets.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-slate-400 dark:text-slate-500">
                      You haven't opened any support tickets yet.
                    </td>
                  </tr>
                ) : (
                  tickets.map((t) => (
                    <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="py-3.5 px-4 font-medium text-slate-900 dark:text-slate-100">
                        <div>{t.subject}</div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1 mt-0.5">{t.description}</p>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          t.priority === 'CRITICAL' ? 'bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-300' :
                          t.priority === 'HIGH' ? 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300' :
                          'bg-sky-100 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300'
                        }`}>
                          {t.priority}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          t.status === 'RESOLVED' ? 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' :
                          t.status === 'IN_PROGRESS' ? 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300' :
                          'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                        }`}>
                          {t.status === 'RESOLVED' && <CheckCircle2 className="w-3 h-3" />}
                          {t.status}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-xs text-slate-500 dark:text-slate-400">
                        {new Date(t.created_at).toLocaleDateString('en-IN')}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Ticket Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 max-w-lg w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="font-bold text-slate-900 dark:text-slate-100 text-lg flex items-center gap-2">
                <LifeBuoy className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                Submit Support Ticket
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-200 text-xl font-bold leading-none" aria-label="Close"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleCreateTicket} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">Subject</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Issue connecting USB Thermal Receipt Printer"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-sm bg-white dark:bg-slate-900 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">Priority Level</label>
                <Select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-sm bg-white dark:bg-slate-900 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                >
                  <option value="LOW">Low - General Question</option>
                  <option value="MEDIUM">Medium - Setup Help</option>
                  <option value="HIGH">High - Billing Interruption</option>
                  <option value="CRITICAL">Critical - System Offline</option>
                </Select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">Description & Details</label>
                <textarea
                  rows={4}
                  required
                  placeholder="Describe your question or issue in detail..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-sm bg-white dark:bg-slate-900 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn-brand px-5 py-2 rounded-xl text-sm font-medium shadow-sm transition disabled:opacity-50"
                >
                  {submitting ? 'Submitting...' : 'Submit Ticket'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
