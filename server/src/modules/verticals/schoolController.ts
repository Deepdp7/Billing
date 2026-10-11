import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../db/connection.js';
import { AuthenticatedRequest } from '../../middleware/auth.js';

// ============================================================================
// SCHOOL & INSTITUTE FEE COLLECTION VERTICAL CONTROLLER (PRD §5)
// ============================================================================

export function getStudents(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId!;
  const { gradeClass, search } = req.query as { gradeClass?: string; search?: string };

  let query = 'SELECT * FROM students WHERE business_id = ?';
  const params: any[] = [businessId];

  if (gradeClass) {
    query += ' AND grade_class = ?';
    params.push(gradeClass);
  }

  if (search) {
    query += ' AND (student_name LIKE ? OR admission_number LIKE ? OR guardian_name LIKE ? OR guardian_phone LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  query += ' ORDER BY grade_class ASC, student_name ASC';

  const students = db.prepare(query).all(...params);
  res.json({ students });
}

export function getStudentById(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId!;
  const { id } = req.params;

  const student = db.prepare('SELECT * FROM students WHERE id = ? AND business_id = ?').get(id, businessId) as any;
  if (!student) {
    res.status(404).json({ error: 'Student not found' });
    return;
  }

  const receipts = db.prepare(`
    SELECT * FROM fee_receipts WHERE student_id = ? AND business_id = ? ORDER BY receipt_date DESC, created_at DESC
  `).all(id, businessId);

  res.json({ student, receipts });
}

export function createStudent(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId!;
  const {
    admission_number,
    student_name,
    grade_class,
    section = 'A',
    roll_number,
    guardian_name,
    guardian_phone,
    guardian_email,
    annual_fees_paise,
  } = req.body;

  if (!student_name || !grade_class || !guardian_name || !guardian_phone) {
    res.status(400).json({ error: 'Student name, grade/class, guardian name, and phone are required' });
    return;
  }

  // Auto-generate admission number if not provided
  let admNumber = admission_number;
  if (!admNumber) {
    const countRow = db.prepare('SELECT COUNT(*) as count FROM students WHERE business_id = ?').get(businessId) as { count: number };
    const seq = String((countRow?.count || 0) + 1).padStart(4, '0');
    const year = new Date().getFullYear();
    admNumber = `ADM-${year}-${seq}`;
  }

  // Calculate annual fees from fee structures if not explicitly specified
  let totalAnnualFeesPaise = Number(annual_fees_paise);
  if (isNaN(totalAnnualFeesPaise) || totalAnnualFeesPaise <= 0) {
    const feeItems = db.prepare('SELECT amount_paise, term_period FROM fee_structures WHERE business_id = ? AND grade_class = ?').all(businessId, grade_class) as any[];
    if (feeItems.length > 0) {
      totalAnnualFeesPaise = feeItems.reduce((sum, item) => {
        const mult = item.term_period === 'MONTHLY' ? 12 : item.term_period === 'QUARTERLY' ? 4 : 1;
        return sum + (item.amount_paise * mult);
      }, 0);
    } else {
      totalAnnualFeesPaise = 2400000; // Default ₹24,000 / year
    }
  }

  const studentId = uuidv4();

  db.prepare(`
    INSERT INTO students (
      id, business_id, admission_number, student_name, grade_class, section,
      roll_number, guardian_name, guardian_phone, guardian_email,
      annual_fees_paise, paid_fees_paise, outstanding_fees_paise, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'ACTIVE')
  `).run(
    studentId, businessId, admNumber, student_name, grade_class, section || 'A',
    roll_number || null, guardian_name, guardian_phone, guardian_email || null,
    totalAnnualFeesPaise, totalAnnualFeesPaise
  );

  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);
  res.status(201).json({ message: 'Student registered successfully', student });
}

export function updateStudent(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId!;
  const { id } = req.params;
  const {
    student_name,
    grade_class,
    section,
    roll_number,
    guardian_name,
    guardian_phone,
    guardian_email,
    status,
  } = req.body;

  const result = db.prepare(`
    UPDATE students SET
      student_name = coalesce(?, student_name),
      grade_class = coalesce(?, grade_class),
      section = coalesce(?, section),
      roll_number = coalesce(?, roll_number),
      guardian_name = coalesce(?, guardian_name),
      guardian_phone = coalesce(?, guardian_phone),
      guardian_email = coalesce(?, guardian_email),
      status = coalesce(?, status),
      updated_at = datetime('now')
    WHERE id = ? AND business_id = ?
  `).run(
    student_name, grade_class, section, roll_number,
    guardian_name, guardian_phone, guardian_email, status,
    id, businessId
  );

  if (result.changes === 0) {
    res.status(404).json({ error: 'Student not found' });
    return;
  }

  const updated = db.prepare('SELECT * FROM students WHERE id = ?').get(id);
  res.json({ message: 'Student updated successfully', student: updated });
}

export function getFeeStructures(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId!;
  const { gradeClass } = req.query as { gradeClass?: string };

  let query = 'SELECT * FROM fee_structures WHERE business_id = ?';
  const params: any[] = [businessId];

  if (gradeClass) {
    query += ' AND grade_class = ?';
    params.push(gradeClass);
  }

  query += ' ORDER BY grade_class ASC, fee_name ASC';

  const feeStructures = db.prepare(query).all(...params);
  res.json({ feeStructures });
}

export function createFeeStructure(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId!;
  const {
    fee_name,
    grade_class,
    term_period = 'MONTHLY',
    amount_paise,
    description,
  } = req.body;

  if (!fee_name || !grade_class || !amount_paise) {
    res.status(400).json({ error: 'Fee name, grade/class, and fee amount are required' });
    return;
  }

  const id = uuidv4();
  db.prepare(`
    INSERT INTO fee_structures (id, business_id, fee_name, grade_class, term_period, amount_paise, description)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, businessId, fee_name, grade_class, term_period, Number(amount_paise), description || null);

  const created = db.prepare('SELECT * FROM fee_structures WHERE id = ?').get(id);
  res.status(201).json({ message: 'Fee structure created', feeStructure: created });
}

export function getFeeReceipts(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId!;
  const { studentId, search } = req.query as { studentId?: string; search?: string };

  let query = `
    SELECT fr.*, s.admission_number, s.guardian_name, s.guardian_phone
    FROM fee_receipts fr
    JOIN students s ON s.id = fr.student_id
    WHERE fr.business_id = ?
  `;
  const params: any[] = [businessId];

  if (studentId) {
    query += ' AND fr.student_id = ?';
    params.push(studentId);
  }

  if (search) {
    query += ' AND (fr.receipt_number LIKE ? OR fr.student_name LIKE ? OR s.admission_number LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  query += ' ORDER BY fr.created_at DESC LIMIT 100';

  const receipts = db.prepare(query).all(...params);
  res.json({ receipts });
}

export function getFeeReceiptById(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId!;
  const { id } = req.params;

  const receipt = db.prepare(`
    SELECT fr.*, s.admission_number, s.guardian_name, s.guardian_phone, s.guardian_email,
           b.name as school_name, b.address as school_address, b.city as school_city, b.phone as school_phone
    FROM fee_receipts fr
    JOIN students s ON s.id = fr.student_id
    JOIN businesses b ON b.id = fr.business_id
    WHERE fr.id = ? AND fr.business_id = ?
  `).get(id, businessId);

  if (!receipt) {
    res.status(404).json({ error: 'Fee receipt not found' });
    return;
  }

  res.json({ receipt });
}

export function createFeeReceipt(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId!;
  const userId = req.user?.userId;
  const {
    student_id,
    amount_paise,
    payment_mode = 'CASH',
    term_period = 'MONTHLY',
    fee_breakdown = [],
    notes,
  } = req.body;

  if (!student_id || !amount_paise || Number(amount_paise) <= 0) {
    res.status(400).json({ error: 'Student ID and positive collection amount are required' });
    return;
  }

  const student = db.prepare('SELECT * FROM students WHERE id = ? AND business_id = ?').get(student_id, businessId) as any;
  if (!student) {
    res.status(404).json({ error: 'Student record not found' });
    return;
  }

  const paymentAmount = Number(amount_paise);
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const countRow = db.prepare(`
    SELECT COUNT(*) as count FROM fee_receipts WHERE business_id = ? AND date(created_at) = date('now')
  `).get(businessId) as { count: number };
  const seq = String((countRow?.count || 0) + 1).padStart(3, '0');
  const receiptNumber = `FEE-${dateStr}-${seq}`;
  const receiptId = uuidv4();

  const collectTx = db.transaction(() => {
    // 1. Insert Receipt
    db.prepare(`
      INSERT INTO fee_receipts (
        id, business_id, receipt_number, student_id, student_name, grade_class,
        amount_paise, payment_mode, term_period, fee_breakdown_json, notes, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      receiptId, businessId, receiptNumber, student.id, student.student_name, student.grade_class,
      paymentAmount, payment_mode, term_period, JSON.stringify(fee_breakdown), notes || null, userId || null
    );

    // 2. Update Student Balances
    const newPaid = (student.paid_fees_paise || 0) + paymentAmount;
    const newOutstanding = Math.max(0, (student.annual_fees_paise || 0) - newPaid);

    db.prepare(`
      UPDATE students SET
        paid_fees_paise = ?,
        outstanding_fees_paise = ?,
        updated_at = datetime('now')
      WHERE id = ? AND business_id = ?
    `).run(newPaid, newOutstanding, student.id, businessId);

    return { receiptId, receiptNumber, newPaid, newOutstanding };
  });

  try {
    const result = collectTx();
    res.status(201).json({
      message: `Fee payment of ₹${(paymentAmount / 100).toFixed(2)} recorded successfully`,
      receiptId: result.receiptId,
      receiptNumber: result.receiptNumber,
      updatedPaidFeesPaise: result.newPaid,
      updatedOutstandingFeesPaise: result.newOutstanding,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to record fee receipt' });
  }
}

export function getSchoolSummary(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId!;

  const stats = db.prepare(`
    SELECT 
      COUNT(*) as total_students,
      SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) as active_students,
      SUM(annual_fees_paise) as total_annual_fees_paise,
      SUM(paid_fees_paise) as total_collected_fees_paise,
      SUM(outstanding_fees_paise) as total_outstanding_fees_paise
    FROM students
    WHERE business_id = ?
  `).get(businessId) as any;

  const totalFees = stats?.total_annual_fees_paise || 0;
  const collectedFees = stats?.total_collected_fees_paise || 0;
  const collectionRate = totalFees > 0 ? Number(((collectedFees / totalFees) * 100).toFixed(1)) : 0;

  // Grade-wise student counts
  const gradeBreakdown = db.prepare(`
    SELECT grade_class, COUNT(*) as student_count,
           SUM(annual_fees_paise) as fees_expected,
           SUM(paid_fees_paise) as fees_collected,
           SUM(outstanding_fees_paise) as fees_outstanding
    FROM students
    WHERE business_id = ?
    GROUP BY grade_class
    ORDER BY grade_class ASC
  `).all(businessId);

  res.json({
    total_students: stats?.total_students || 0,
    active_students: stats?.active_students || 0,
    total_annual_fees_paise: totalFees,
    total_collected_fees_paise: collectedFees,
    total_outstanding_fees_paise: stats?.total_outstanding_fees_paise || 0,
    collection_rate_percent: collectionRate,
    grade_breakdown: gradeBreakdown,
  });
}
