import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api.js';
import { Student, FeeStructure, FeeReceipt } from '../../types/index.js';
import { useLanguage } from '../../context/LanguageContext.js';
import { 
  GraduationCap, Users, Receipt, CreditCard, Plus, Search, 
  RefreshCw, CheckCircle2, AlertCircle, Printer, Filter, DollarSign,
  Calendar, Phone, UserCheck, BookOpen, ChevronRight, X
} from 'lucide-react';

export const SchoolFeesPage: React.FC = () => {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<'students' | 'receipts' | 'structures'>('students');
  const [students, setStudents] = useState<Student[]>([]);
  const [feeStructures, setFeeStructures] = useState<FeeStructure[]>([]);
  const [receipts, setReceipts] = useState<FeeReceipt[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [classFilter, setClassFilter] = useState('ALL');

  // Modals
  const [showCollectModal, setShowCollectModal] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [collectForm, setCollectForm] = useState({
    feeStructureId: '',
    amountPaid: 0,
    paymentMode: 'UPI' as 'CASH' | 'UPI' | 'CARD' | 'NET_BANKING' | 'CHEQUE',
    transactionRef: '',
    periodMonthYear: 'October 2026',
    notes: 'Term Tuition Fee',
  });

  const [showNewStudentModal, setShowNewStudentModal] = useState(false);
  const [studentForm, setStudentForm] = useState({
    admissionNumber: '',
    name: '',
    classGrade: 'Class 10',
    section: 'A',
    rollNumber: '',
    guardianName: '',
    guardianPhone: '',
    address: '',
    totalFeeDue: 35000,
    discountPercentage: 0,
  });

  const [showNewStructureModal, setShowNewStructureModal] = useState(false);
  const [structureForm, setStructureForm] = useState({
    name: 'Class 10 Term Tuition',
    classGrade: 'Class 10',
    feeType: 'TUITION' as any,
    amount: 3500,
    frequency: 'MONTHLY' as any,
  });

  const [printedReceipt, setPrintedReceipt] = useState<FeeReceipt | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [stuRes, structRes, rcpRes, sumRes] = await Promise.all([
        api.getStudents(),
        api.getFeeStructures(),
        api.getFeeReceipts(50),
        api.getSchoolSummary(),
      ]);

      const mappedStudents = ((stuRes as any).students || []).map((s: any) => ({
        ...s,
        name: s.name || s.student_name,
        admissionNumber: s.admissionNumber || s.admission_number,
        classGrade: s.classGrade || s.grade_class,
        rollNumber: s.rollNumber || s.roll_number,
        guardianName: s.guardianName || s.guardian_name,
        guardianPhone: s.guardianPhone || s.guardian_phone,
        outstandingBalance: s.outstandingBalance !== undefined ? s.outstandingBalance : (s.outstanding_fees_paise || 0) / 100,
        totalFeeDue: s.totalFeeDue !== undefined ? s.totalFeeDue : (s.annual_fees_paise || 0) / 100,
      }));

      const mappedStructures = (((structRes as any).feeStructures || (structRes as any).structures) || []).map((fs: any) => ({
        ...fs,
        name: fs.name || fs.fee_name,
        classGrade: fs.classGrade || fs.grade_class,
        amount: fs.amount !== undefined ? fs.amount : (fs.amount_paise || 0) / 100,
        feeType: fs.feeType || fs.term_period || 'TUITION',
        frequency: fs.frequency || fs.term_period || 'MONTHLY',
      }));

      const mappedReceipts = ((rcpRes as any).receipts || []).map((r: any) => ({
        ...r,
        receiptNumber: r.receiptNumber || r.receipt_number,
        studentName: r.studentName || r.student_name,
        classGrade: r.classGrade || r.grade_class,
        amountPaid: r.amountPaid !== undefined ? r.amountPaid : (r.amount_paise || 0) / 100,
        paymentMode: r.paymentMode || r.payment_mode,
        paymentDate: r.paymentDate || r.receipt_date,
        periodMonthYear: r.periodMonthYear || r.term_period,
        balanceAfterPayment: r.balanceAfterPayment !== undefined ? r.balanceAfterPayment : (r.outstanding_fees_paise || 0) / 100,
      }));

      setStudents(mappedStudents);
      setFeeStructures(mappedStructures);
      setReceipts(mappedReceipts);
      setSummary(sumRes.summary || null);
    } catch (err: any) {
      setNotification({ type: 'error', message: err.message || 'Failed to load school records' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCollectFee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStudent) return;
    setSubmitting(true);
    try {
      const res = await api.createFeeReceipt({
        studentId: selectedStudent.id,
        feeStructureId: collectForm.feeStructureId || undefined,
        amountPaid: Number(collectForm.amountPaid),
        paymentMode: collectForm.paymentMode,
        transactionRef: collectForm.transactionRef,
        periodMonthYear: collectForm.periodMonthYear,
        notes: collectForm.notes,
      });

      const receiptObj: any = {
        receiptNumber: res.receiptNumber,
        studentName: selectedStudent.name || (selectedStudent as any).student_name,
        classGrade: selectedStudent.classGrade || (selectedStudent as any).grade_class,
        paymentDate: new Date().toISOString(),
        paymentMode: collectForm.paymentMode,
        periodMonthYear: collectForm.periodMonthYear,
        amountPaid: Number(collectForm.amountPaid),
        balanceAfterPayment: (res.updatedOutstandingFeesPaise || 0) / 100,
        transactionRef: collectForm.transactionRef,
      };

      setNotification({
        type: 'success',
        message: `Fee collected! Receipt ${res.receiptNumber} generated.`,
      });
      setShowCollectModal(false);
      setPrintedReceipt(receiptObj);
      fetchData();
      setTimeout(() => setNotification(null), 4000);
    } catch (err: any) {
      setNotification({ type: 'error', message: err.message || 'Fee collection failed' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.createStudent(studentForm);
      setNotification({ type: 'success', message: 'Student registered successfully!' });
      setShowNewStudentModal(false);
      setStudentForm({
        admissionNumber: '',
        name: '',
        classGrade: 'Class 10',
        section: 'A',
        rollNumber: '',
        guardianName: '',
        guardianPhone: '',
        address: '',
        totalFeeDue: 35000,
        discountPercentage: 0,
      });
      fetchData();
      setTimeout(() => setNotification(null), 4000);
    } catch (err: any) {
      setNotification({ type: 'error', message: err.message || 'Failed to enroll student' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateStructure = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.createFeeStructure({
        ...structureForm,
        amount: Number(structureForm.amount),
      });
      setNotification({ type: 'success', message: 'Fee structure created!' });
      setShowNewStructureModal(false);
      fetchData();
      setTimeout(() => setNotification(null), 4000);
    } catch (err: any) {
      setNotification({ type: 'error', message: err.message || 'Failed to create fee head' });
    } finally {
      setSubmitting(false);
    }
  };

  const openCollectModalForStudent = (stu: Student) => {
    setSelectedStudent(stu);
    const defaultAmount = stu.outstandingBalance > 0 ? Math.min(stu.outstandingBalance, 3500) : 3500;
    setCollectForm({
      feeStructureId: feeStructures[0]?.id || '',
      amountPaid: defaultAmount,
      paymentMode: 'UPI',
      transactionRef: '',
      periodMonthYear: 'October 2026',
      notes: `Fee payment for ${stu.name}`,
    });
    setShowCollectModal(true);
  };

  // Filters
  const filteredStudents = students.filter((stu) => {
    if (classFilter !== 'ALL' && stu.classGrade !== classFilter) return false;
    if (
      searchQuery &&
      !stu.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
      !stu.admissionNumber.toLowerCase().includes(searchQuery.toLowerCase()) &&
      !stu.guardianPhone.includes(searchQuery)
    ) {
      return false;
    }
    return true;
  });

  const distinctClasses = Array.from(new Set(students.map((s) => s.classGrade))).filter(Boolean);

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
          <button
            onClick={() => setNotification(null)}
            className="text-xs uppercase font-bold tracking-wider opacity-70 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white shadow-lg shadow-emerald-600/30">
            <GraduationCap className="w-7 h-7 fill-white" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
              {t('school', 'School & Fee Management')}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              PRD §5 Education Vertical · Student Directory, Due Fees & Official Receipts
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

          <button
            onClick={() => setShowNewStudentModal(true)}
            className="flex items-center gap-2 px-3.5 py-2 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-600/25 transition"
          >
            <Plus className="w-4 h-4" />
            <span>New Student Admission</span>
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Active Students</span>
            <Users className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white">
            {summary?.totalStudents ?? students.length} <span className="text-xs font-medium text-slate-400">Enrolled</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Across all grade levels</p>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Total Fees Collected</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400">
            ₹{(summary?.totalFeesCollected ?? 0).toLocaleString('en-IN')}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Processed atomic receipts</p>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Total Due / Outstanding</span>
            <AlertCircle className="w-4 h-4 text-rose-500" />
          </div>
          <div className="text-2xl font-black text-rose-600 dark:text-rose-400">
            ₹{(summary?.totalOutstandingDue ?? 0).toLocaleString('en-IN')}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Pending parent payments</p>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Fee Structures</span>
            <BookOpen className="w-4 h-4 text-teal-500" />
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white">
            {feeStructures.length} <span className="text-xs font-medium text-slate-400">Defined</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Tuition, exams, lab & sports</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800">
        <button
          onClick={() => setActiveTab('students')}
          className={`flex items-center gap-2 px-4 py-3 text-xs font-bold border-b-2 transition ${
            activeTab === 'students'
              ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>{t('studentDirectory', 'Student Directory & Fees')} ({students.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('receipts')}
          className={`flex items-center gap-2 px-4 py-3 text-xs font-bold border-b-2 transition ${
            activeTab === 'receipts'
              ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <Receipt className="w-4 h-4" />
          <span>{t('feeReceipts', 'Fee Receipts History')} ({receipts.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('structures')}
          className={`flex items-center gap-2 px-4 py-3 text-xs font-bold border-b-2 transition ${
            activeTab === 'structures'
              ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <BookOpen className="w-4 h-4" />
          <span>{t('feeStructures', 'Fee Structures')} ({feeStructures.length})</span>
        </button>
      </div>

      {/* TAB 1: Student Directory */}
      {activeTab === 'students' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden space-y-4">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Filter Grade:</span>
              <select
                value={classFilter}
                onChange={(e) => setClassFilter(e.target.value)}
                className="text-xs px-2.5 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200"
              >
                <option value="ALL">All Classes</option>
                {distinctClasses.map((cls) => (
                  <option key={cls} value={cls}>{cls}</option>
                ))}
              </select>
            </div>

            {/* Search */}
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder={t('search', 'Search student name, adm no, phone...')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider text-[10px] border-b border-slate-100 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3">Adm No</th>
                  <th className="px-4 py-3">Student Name</th>
                  <th className="px-4 py-3">Class & Sec</th>
                  <th className="px-4 py-3">Guardian & Phone</th>
                  <th className="px-4 py-3 text-right">Total Due</th>
                  <th className="px-4 py-3 text-right">Balance Due</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {filteredStudents.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                      No students found matching current filters.
                    </td>
                  </tr>
                ) : (
                  filteredStudents.map((stu) => {
                    const hasDue = stu.outstandingBalance > 0;
                    return (
                      <tr key={stu.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition">
                        <td className="px-4 py-3 font-mono font-bold text-slate-700 dark:text-slate-300">
                          {stu.admissionNumber}
                        </td>
                        <td className="px-4 py-3 font-semibold text-slate-900 dark:text-white">
                          {stu.name}
                          {stu.rollNumber && (
                            <span className="text-[10px] text-slate-400 ml-1.5">
                              (Roll {stu.rollNumber})
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-600 dark:text-slate-400">
                          {stu.classGrade} {stu.section ? `- ${stu.section}` : ''}
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-slate-800 dark:text-slate-200 font-medium">{stu.guardianName}</div>
                          <div className="text-[10px] text-slate-400 font-mono">{stu.guardianPhone}</div>
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-slate-600 dark:text-slate-400">
                          ₹{stu.totalFeeDue.toLocaleString('en-IN')}
                        </td>
                        <td className="px-4 py-3 text-right font-black">
                          <span className={hasDue ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}>
                            ₹{stu.outstandingBalance.toLocaleString('en-IN')}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                              stu.status === 'ACTIVE'
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                                : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                            }`}
                          >
                            {stu.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => openCollectModalForStudent(stu)}
                            className="px-3 py-1.5 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition"
                          >
                            {t('collectFee', 'Collect Fee')}
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: Fee Receipts History */}
      {activeTab === 'receipts' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <h2 className="font-bold text-sm text-slate-900 dark:text-white">
              Fee Receipts Ledger
            </h2>
            <span className="text-xs text-slate-400">Showing last {receipts.length} transactions</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider text-[10px] border-b border-slate-100 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3">Receipt No</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Student Name</th>
                  <th className="px-4 py-3">Period</th>
                  <th className="px-4 py-3">Payment Mode</th>
                  <th className="px-4 py-3 text-right">Amount Paid</th>
                  <th className="px-4 py-3 text-right">Bal. After</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {receipts.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                      No fee receipts recorded yet.
                    </td>
                  </tr>
                ) : (
                  receipts.map((rcp) => (
                    <tr key={rcp.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition">
                      <td className="px-4 py-3 font-mono font-bold text-emerald-600 dark:text-emerald-400">
                        {rcp.receiptNumber}
                      </td>
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-400">
                        {new Date(rcp.paymentDate).toLocaleDateString('en-IN', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </td>
                      <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100">
                        {rcp.studentName}
                        {rcp.classGrade && (
                          <span className="text-[10px] text-slate-400 ml-1.5">
                            ({rcp.classGrade})
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400 font-medium">
                        {rcp.periodMonthYear || 'Term Fee'}
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                          {rcp.paymentMode}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-black text-emerald-600 dark:text-emerald-400">
                        ₹{rcp.amountPaid.toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-slate-500 dark:text-slate-400">
                        ₹{rcp.balanceAfterPayment.toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => setPrintedReceipt(rcp)}
                          className="flex items-center gap-1.5 ml-auto px-2.5 py-1 text-[11px] font-bold rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
                        >
                          <Printer className="w-3 h-3 text-slate-500" />
                          <span>Print Slip</span>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: Fee Structures Master */}
      {activeTab === 'structures' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden space-y-4">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <div>
              <h2 className="font-bold text-sm text-slate-900 dark:text-white">
                Fee Structure Heads & Tariffs
              </h2>
              <p className="text-[11px] text-slate-400">Standard fees defined by grade level</p>
            </div>
            <button
              onClick={() => setShowNewStructureModal(true)}
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold rounded-xl bg-teal-600 hover:bg-teal-700 text-white shadow-sm transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Fee Structure</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider text-[10px] border-b border-slate-100 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3">Fee Head Name</th>
                  <th className="px-4 py-3">Grade / Class</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Frequency</th>
                  <th className="px-4 py-3 text-right">Standard Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {feeStructures.map((fs) => (
                  <tr key={fs.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition">
                    <td className="px-4 py-3 font-semibold text-slate-900 dark:text-white">
                      {fs.name}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                      {fs.classGrade}
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-teal-50 dark:bg-teal-950/50 text-teal-700 dark:text-teal-300">
                        {fs.feeType}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400 font-medium">
                      {fs.frequency}
                    </td>
                    <td className="px-4 py-3 text-right font-black text-slate-900 dark:text-white">
                      ₹{fs.amount.toLocaleString('en-IN')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Collect Fee Modal */}
      {showCollectModal && selectedStudent && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-lg w-full p-6 animate-scaleIn">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Receipt className="w-5 h-5 text-emerald-600" />
                <h3 className="font-bold text-slate-900 dark:text-white">
                  Collect Student Fee & Issue Receipt
                </h3>
              </div>
              <button
                onClick={() => setShowCollectModal(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCollectFee} className="space-y-4 mt-4 text-xs">
              {/* Student Summary pill */}
              <div className="p-3 rounded-xl bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 flex justify-between items-center">
                <div>
                  <div className="font-bold text-emerald-900 dark:text-emerald-200 text-sm">{selectedStudent.name}</div>
                  <div className="text-slate-500">{selectedStudent.classGrade} · Adm No: {selectedStudent.admissionNumber}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase font-semibold text-slate-400">Balance Due</div>
                  <div className="font-black text-rose-600 dark:text-rose-400 text-base">
                    ₹{selectedStudent.outstandingBalance.toLocaleString('en-IN')}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Fee Head / Tariff
                  </label>
                  <select
                    value={collectForm.feeStructureId}
                    onChange={(e) => setCollectForm({ ...collectForm, feeStructureId: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                  >
                    <option value="">General Balance Deduction</option>
                    {feeStructures.map((fs) => (
                      <option key={fs.id} value={fs.id}>
                        {fs.name} (₹{fs.amount})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Amount Received (₹)
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={collectForm.amountPaid}
                    onChange={(e) => setCollectForm({ ...collectForm, amountPaid: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-bold text-sm"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Payment Mode
                  </label>
                  <select
                    value={collectForm.paymentMode}
                    onChange={(e: any) => setCollectForm({ ...collectForm, paymentMode: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                  >
                    <option value="UPI">UPI / QR Code</option>
                    <option value="CASH">Cash</option>
                    <option value="CARD">Debit / Credit Card</option>
                    <option value="NET_BANKING">Net Banking / NEFT</option>
                    <option value="CHEQUE">Cheque / DD</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Period / Term
                  </label>
                  <input
                    type="text"
                    value={collectForm.periodMonthYear}
                    onChange={(e) => setCollectForm({ ...collectForm, periodMonthYear: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                    placeholder="e.g. October 2026 / Term 1"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Transaction Ref / Notes
                </label>
                <input
                  type="text"
                  value={collectForm.transactionRef}
                  onChange={(e) => setCollectForm({ ...collectForm, transactionRef: e.target.value })}
                  placeholder="Optional UPI UTR No / Cheque No / Notes"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowCollectModal(false)}
                  className="px-4 py-2 font-semibold rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-600/30 transition"
                >
                  {submitting ? 'Generating Receipt...' : 'Confirm Payment & Print'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New Student Admission Modal */}
      {showNewStudentModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-lg w-full p-6 animate-scaleIn">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-emerald-600" />
                <h3 className="font-bold text-slate-900 dark:text-white">
                  New Student Admission
                </h3>
              </div>
              <button
                onClick={() => setShowNewStudentModal(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateStudent} className="space-y-3 mt-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Admission Number
                  </label>
                  <input
                    type="text"
                    value={studentForm.admissionNumber}
                    onChange={(e) => setStudentForm({ ...studentForm, admissionNumber: e.target.value })}
                    placeholder="e.g. ADM-2026-088"
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                    required
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Student Full Name
                  </label>
                  <input
                    type="text"
                    value={studentForm.name}
                    onChange={(e) => setStudentForm({ ...studentForm, name: e.target.value })}
                    placeholder="e.g. Ananya Roy"
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Class / Grade
                  </label>
                  <input
                    type="text"
                    value={studentForm.classGrade}
                    onChange={(e) => setStudentForm({ ...studentForm, classGrade: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                    required
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Section
                  </label>
                  <input
                    type="text"
                    value={studentForm.section}
                    onChange={(e) => setStudentForm({ ...studentForm, section: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Roll No
                  </label>
                  <input
                    type="text"
                    value={studentForm.rollNumber}
                    onChange={(e) => setStudentForm({ ...studentForm, rollNumber: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Guardian Name
                  </label>
                  <input
                    type="text"
                    value={studentForm.guardianName}
                    onChange={(e) => setStudentForm({ ...studentForm, guardianName: e.target.value })}
                    placeholder="Father / Mother Name"
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                    required
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Guardian Phone
                  </label>
                  <input
                    type="tel"
                    value={studentForm.guardianPhone}
                    onChange={(e) => setStudentForm({ ...studentForm, guardianPhone: e.target.value })}
                    placeholder="10-digit mobile"
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Annual Fee Tariff (₹)
                  </label>
                  <input
                    type="number"
                    value={studentForm.totalFeeDue}
                    onChange={(e) => setStudentForm({ ...studentForm, totalFeeDue: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-bold"
                    required
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Scholarship / Discount %
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={studentForm.discountPercentage}
                    onChange={(e) => setStudentForm({ ...studentForm, discountPercentage: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowNewStudentModal(false)}
                  className="px-4 py-2 font-semibold rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-md transition"
                >
                  {submitting ? 'Enrolling...' : 'Enroll Student'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New Fee Structure Modal */}
      {showNewStructureModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-md w-full p-6 animate-scaleIn">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-white">
                Add New Fee Structure
              </h3>
              <button
                onClick={() => setShowNewStructureModal(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateStructure} className="space-y-3 mt-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Structure Name
                </label>
                <input
                  type="text"
                  value={structureForm.name}
                  onChange={(e) => setStructureForm({ ...structureForm, name: e.target.value })}
                  placeholder="e.g. Class 12 Science Lab Fee"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Class / Grade
                  </label>
                  <input
                    type="text"
                    value={structureForm.classGrade}
                    onChange={(e) => setStructureForm({ ...structureForm, classGrade: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                    required
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Fee Type
                  </label>
                  <select
                    value={structureForm.feeType}
                    onChange={(e: any) => setStructureForm({ ...structureForm, feeType: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                  >
                    <option value="TUITION">Tuition</option>
                    <option value="EXAMINATION">Examination</option>
                    <option value="DEVELOPMENT">Development</option>
                    <option value="LAB">Lab & Science</option>
                    <option value="SPORTS">Sports & Activity</option>
                    <option value="TRANSPORT">Transport</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Tariff Amount (₹)
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={structureForm.amount}
                    onChange={(e) => setStructureForm({ ...structureForm, amount: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-bold"
                    required
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Frequency
                  </label>
                  <select
                    value={structureForm.frequency}
                    onChange={(e: any) => setStructureForm({ ...structureForm, frequency: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                  >
                    <option value="MONTHLY">Monthly</option>
                    <option value="QUARTERLY">Quarterly</option>
                    <option value="ANNUAL">Annual</option>
                    <option value="ONE_TIME">One-Time</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowNewStructureModal(false)}
                  className="px-4 py-2 font-semibold rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 font-bold rounded-xl bg-teal-600 hover:bg-teal-700 text-white shadow-md transition"
                >
                  Save Structure
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Printable Receipt Modal */}
      {printedReceipt && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-lg w-full p-6 animate-scaleIn">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-600">
                Official Fee Receipt Slip
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="px-3 py-1 bg-emerald-600 text-white font-bold rounded-lg text-xs flex items-center gap-1.5"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print</span>
                </button>
                <button
                  onClick={() => setPrintedReceipt(null)}
                  className="text-slate-400 hover:text-slate-600 text-lg font-bold"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Slip Paper Body */}
            <div className="p-4 my-3 border border-dashed border-slate-300 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800/40 text-xs space-y-3 font-mono">
              <div className="text-center pb-2 border-b border-slate-200 dark:border-slate-700">
                <div className="font-black text-base text-slate-900 dark:text-white font-['Outfit']">
                  VIDYANIKETAN PUBLIC SCHOOL & ACADEMY
                </div>
                <div className="text-[10px] text-slate-500">
                  Affiliated & Registered Educational Institution
                </div>
                <div className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                  FEE COLLECTION RECEIPT
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div>
                  <span className="text-slate-400">Receipt No: </span>
                  <span className="font-bold text-slate-900 dark:text-white">{printedReceipt.receiptNumber}</span>
                </div>
                <div className="text-right">
                  <span className="text-slate-400">Date: </span>
                  <span className="font-bold text-slate-900 dark:text-white">
                    {new Date(printedReceipt.paymentDate).toLocaleDateString('en-IN')}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400">Student: </span>
                  <span className="font-bold text-slate-900 dark:text-white">{printedReceipt.studentName}</span>
                </div>
                <div className="text-right">
                  <span className="text-slate-400">Class: </span>
                  <span className="font-bold text-slate-900 dark:text-white">{printedReceipt.classGrade || 'N/A'}</span>
                </div>
                <div>
                  <span className="text-slate-400">Period: </span>
                  <span className="font-bold text-slate-900 dark:text-white">{printedReceipt.periodMonthYear || 'Term Fee'}</span>
                </div>
                <div className="text-right">
                  <span className="text-slate-400">Mode: </span>
                  <span className="font-bold text-slate-900 dark:text-white">{printedReceipt.paymentMode}</span>
                </div>
              </div>

              <div className="border-t border-b border-slate-200 dark:border-slate-700 py-2 flex justify-between items-center text-sm font-bold">
                <span>Amount Paid</span>
                <span className="text-emerald-600 dark:text-emerald-400 text-base">
                  ₹{printedReceipt.amountPaid.toLocaleString('en-IN')}.00
                </span>
              </div>

              <div className="flex justify-between items-center text-[11px]">
                <span className="text-slate-400">Remaining Balance:</span>
                <span className="font-bold text-slate-900 dark:text-white">
                  ₹{printedReceipt.balanceAfterPayment.toLocaleString('en-IN')}.00
                </span>
              </div>

              {printedReceipt.transactionRef && (
                <div className="text-[10px] text-slate-400">
                  Ref / Txn ID: {printedReceipt.transactionRef}
                </div>
              )}

              <div className="pt-6 flex justify-between items-end text-[10px] text-slate-400">
                <div>(Seal & Signature)</div>
                <div>Authorized Cashier / Principal</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
