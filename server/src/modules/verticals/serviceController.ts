import { Response } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth.js';
import { db } from '../../db/connection.js';
import { v4 as uuidv4 } from 'uuid';

// --- Service Appointments ---
export function getAppointments(req: AuthenticatedRequest, res: Response): void {
  try {
    const businessId = req.businessId!;
    const status = req.query.status as string | undefined;
    const date = req.query.date as string | undefined;

    let query = `SELECT * FROM service_appointments WHERE business_id = ?`;
    const params: any[] = [businessId];

    if (status) {
      query += ` AND status = ?`;
      params.push(status);
    }
    if (date) {
      query += ` AND appointment_date = ?`;
      params.push(date);
    }

    query += ` ORDER BY appointment_date ASC, appointment_time ASC`;

    const rows = db.prepare(query).all(...params) as any[];

    res.json({
      appointments: rows.map(r => ({
        id: r.id,
        customerName: r.customer_name,
        customerPhone: r.customer_phone,
        serviceName: r.service_name,
        staffName: r.staff_name,
        appointmentDate: r.appointment_date,
        appointmentTime: r.appointment_time,
        status: r.status,
        estimatedCost: (r.estimated_cost_paise || 0) / 100,
        notes: r.notes,
        createdAt: r.created_at,
      }))
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch appointments' });
  }
}

export function createAppointment(req: AuthenticatedRequest, res: Response): void {
  try {
    const businessId = req.businessId!;
    const {
      customerName,
      customerPhone,
      serviceName,
      staffName,
      appointmentDate,
      appointmentTime,
      estimatedCost,
      notes
    } = req.body;

    if (!customerName || !customerPhone || !serviceName || !appointmentDate || !appointmentTime) {
      res.status(400).json({ error: 'Customer, service, date, and time are required' });
      return;
    }

    const id = `apt_${uuidv4()}`;
    const costPaise = Math.round(Number(estimatedCost || 0) * 100);

    db.prepare(`
      INSERT INTO service_appointments (
        id, business_id, customer_name, customer_phone, service_name, staff_name,
        appointment_date, appointment_time, estimated_cost_paise, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      businessId,
      customerName,
      customerPhone,
      serviceName,
      staffName || null,
      appointmentDate,
      appointmentTime,
      costPaise,
      notes || null
    );

    res.status(201).json({
      success: true,
      appointment: {
        id,
        customerName,
        customerPhone,
        serviceName,
        appointmentDate,
        appointmentTime,
        status: 'SCHEDULED',
        estimatedCost: Number(estimatedCost || 0)
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to book appointment' });
  }
}

export function updateAppointmentStatus(req: AuthenticatedRequest, res: Response): void {
  try {
    const businessId = req.businessId!;
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      res.status(400).json({ error: 'Status is required' });
      return;
    }

    db.prepare(`
      UPDATE service_appointments SET status = ? WHERE id = ? AND business_id = ?
    `).run(status, id, businessId);

    res.json({ success: true, message: 'Appointment status updated' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to update status' });
  }
}

// --- Service Records / Job Cards ---
export function getJobCards(req: AuthenticatedRequest, res: Response): void {
  try {
    const businessId = req.businessId!;
    const status = req.query.status as string | undefined;

    let query = `SELECT * FROM service_records WHERE business_id = ?`;
    const params: any[] = [businessId];

    if (status) {
      query += ` AND status = ?`;
      params.push(status);
    }

    query += ` ORDER BY created_at DESC`;

    const rows = db.prepare(query).all(...params) as any[];

    res.json({
      jobCards: rows.map(r => ({
        id: r.id,
        jobCardNumber: r.job_card_number,
        customerName: r.customer_name,
        customerPhone: r.customer_phone,
        assetItemName: r.asset_item_name,
        serialOrRegNumber: r.serial_or_reg_number,
        issueReported: r.issue_reported,
        diagnosisNotes: r.diagnosis_notes,
        partsCost: (r.parts_cost_paise || 0) / 100,
        laborCost: (r.labor_cost_paise || 0) / 100,
        totalCost: (r.total_cost_paise || 0) / 100,
        status: r.status,
        assignedTechnician: r.assigned_technician,
        createdAt: r.created_at,
      }))
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch job cards' });
  }
}

export function createJobCard(req: AuthenticatedRequest, res: Response): void {
  try {
    const businessId = req.businessId!;
    const {
      customerName,
      customerPhone,
      assetItemName,
      serialOrRegNumber,
      issueReported,
      diagnosisNotes,
      partsCost,
      laborCost,
      assignedTechnician
    } = req.body;

    if (!customerName || !customerPhone || !assetItemName || !issueReported) {
      res.status(400).json({ error: 'Customer, asset name, and issue reported are required' });
      return;
    }

    // Generate atomic Job Card Number
    const countRow = db.prepare(`SELECT COUNT(*) as count FROM service_records WHERE business_id = ?`).get(businessId) as any;
    const nextSeq = (countRow?.count || 0) + 1;
    const year = new Date().getFullYear();
    const jobCardNumber = `JOB-${year}-${String(nextSeq).padStart(4, '0')}`;

    const id = `job_${uuidv4()}`;
    const partsPaise = Math.round(Number(partsCost || 0) * 100);
    const laborPaise = Math.round(Number(laborCost || 0) * 100);
    const totalPaise = partsPaise + laborPaise;

    db.prepare(`
      INSERT INTO service_records (
        id, business_id, job_card_number, customer_name, customer_phone, asset_item_name,
        serial_or_reg_number, issue_reported, diagnosis_notes, parts_cost_paise,
        labor_cost_paise, total_cost_paise, status, assigned_technician
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)
    `).run(
      id,
      businessId,
      jobCardNumber,
      customerName,
      customerPhone,
      assetItemName,
      serialOrRegNumber || null,
      issueReported,
      diagnosisNotes || null,
      partsPaise,
      laborPaise,
      totalPaise,
      assignedTechnician || null
    );

    res.status(201).json({
      success: true,
      jobCard: {
        id,
        jobCardNumber,
        customerName,
        assetItemName,
        status: 'PENDING',
        totalCost: totalPaise / 100
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to create job card' });
  }
}

export function updateJobCard(req: AuthenticatedRequest, res: Response): void {
  try {
    const businessId = req.businessId!;
    const { id } = req.params;
    const { diagnosisNotes, partsCost, laborCost, status, assignedTechnician } = req.body;

    const partsPaise = partsCost !== undefined ? Math.round(Number(partsCost) * 100) : 0;
    const laborPaise = laborCost !== undefined ? Math.round(Number(laborCost) * 100) : 0;
    const totalPaise = partsPaise + laborPaise;

    db.prepare(`
      UPDATE service_records SET
        diagnosis_notes = COALESCE(?, diagnosis_notes),
        parts_cost_paise = ?,
        labor_cost_paise = ?,
        total_cost_paise = ?,
        status = COALESCE(?, status),
        assigned_technician = COALESCE(?, assigned_technician)
      WHERE id = ? AND business_id = ?
    `).run(diagnosisNotes || null, partsPaise, laborPaise, totalPaise, status || null, assignedTechnician || null, id, businessId);

    res.json({ success: true, message: 'Job card updated' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to update job card' });
  }
}

// --- Recurring Invoices ---
export function getRecurringInvoices(req: AuthenticatedRequest, res: Response): void {
  try {
    const businessId = req.businessId!;
    const rows = db.prepare(`
      SELECT * FROM recurring_invoices WHERE business_id = ? ORDER BY next_run_date ASC
    `).all(businessId) as any[];

    res.json({
      recurringInvoices: rows.map(r => ({
        id: r.id,
        customerId: r.customer_id,
        customerName: r.customer_name,
        frequency: r.frequency,
        amount: (r.amount_paise || 0) / 100,
        description: r.description,
        nextRunDate: r.next_run_date,
        status: r.status,
        createdAt: r.created_at,
      }))
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch recurring invoices' });
  }
}

export function createRecurringInvoice(req: AuthenticatedRequest, res: Response): void {
  try {
    const businessId = req.businessId!;
    const { customerId, customerName, frequency, amount, description, nextRunDate } = req.body;

    if (!customerId || !customerName || !amount || !description || !nextRunDate) {
      res.status(400).json({ error: 'Customer, amount, description, and next run date required' });
      return;
    }

    const id = `rec_${uuidv4()}`;
    const amountPaise = Math.round(Number(amount) * 100);

    db.prepare(`
      INSERT INTO recurring_invoices (
        id, business_id, customer_id, customer_name, frequency, amount_paise, description, next_run_date, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
    `).run(id, businessId, customerId, customerName, frequency || 'MONTHLY', amountPaise, description, nextRunDate);

    res.status(201).json({
      success: true,
      recurringInvoice: {
        id,
        customerName,
        frequency: frequency || 'MONTHLY',
        amount: Number(amount),
        nextRunDate,
        status: 'ACTIVE'
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to create recurring contract' });
  }
}

// --- Hardware & Gateway Settings ---
export function getHardwareSettings(req: AuthenticatedRequest, res: Response): void {
  try {
    const businessId = req.businessId!;

    let settings = db.prepare(`SELECT * FROM hardware_settings WHERE business_id = ?`).get(businessId) as any;

    if (!settings) {
      const id = `hw_${uuidv4()}`;
      db.prepare(`
        INSERT INTO hardware_settings (id, business_id) VALUES (?, ?)
      `).run(id, businessId);

      settings = db.prepare(`SELECT * FROM hardware_settings WHERE business_id = ?`).get(businessId) as any;
    }

    res.json({
      settings: {
        id: settings.id,
        printerType: settings.printer_type,
        printerInterface: settings.printer_interface,
        autoCutPaper: Boolean(settings.auto_cut_paper),
        openCashDrawer: Boolean(settings.open_cash_drawer),
        weighingScaleEnabled: Boolean(settings.weighing_scale_enabled),
        weighingScaleBaudRate: settings.weighing_scale_baud_rate || 9600,
        smsGatewayProvider: settings.sms_gateway_provider,
        smsApiKey: settings.sms_api_key || '',
        smsSenderId: settings.sms_sender_id || '',
        autoSendBillSms: Boolean(settings.auto_send_bill_sms),
        autoSendAppointmentSms: Boolean(settings.auto_send_appointment_sms),
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch hardware settings' });
  }
}

export function updateHardwareSettings(req: AuthenticatedRequest, res: Response): void {
  try {
    const businessId = req.businessId!;
    const {
      printerType,
      printerInterface,
      autoCutPaper,
      openCashDrawer,
      weighingScaleEnabled,
      weighingScaleBaudRate,
      smsGatewayProvider,
      smsApiKey,
      smsSenderId,
      autoSendBillSms,
      autoSendAppointmentSms
    } = req.body;

    db.prepare(`
      INSERT INTO hardware_settings (
        id, business_id, printer_type, printer_interface, auto_cut_paper, open_cash_drawer,
        weighing_scale_enabled, weighing_scale_baud_rate, sms_gateway_provider, sms_api_key,
        sms_sender_id, auto_send_bill_sms, auto_send_appointment_sms, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(business_id) DO UPDATE SET
        printer_type = excluded.printer_type,
        printer_interface = excluded.printer_interface,
        auto_cut_paper = excluded.auto_cut_paper,
        open_cash_drawer = excluded.open_cash_drawer,
        weighing_scale_enabled = excluded.weighing_scale_enabled,
        weighing_scale_baud_rate = excluded.weighing_scale_baud_rate,
        sms_gateway_provider = excluded.sms_gateway_provider,
        sms_api_key = excluded.sms_api_key,
        sms_sender_id = excluded.sms_sender_id,
        auto_send_bill_sms = excluded.auto_send_bill_sms,
        auto_send_appointment_sms = excluded.auto_send_appointment_sms,
        updated_at = datetime('now')
    `).run(
      `hw_${uuidv4()}`,
      businessId,
      printerType || 'THERMAL_80MM',
      printerInterface || 'BROWSER_POPUP',
      autoCutPaper ? 1 : 0,
      openCashDrawer ? 1 : 0,
      weighingScaleEnabled ? 1 : 0,
      Number(weighingScaleBaudRate || 9600),
      smsGatewayProvider || 'WHATSAPP_DIRECT',
      smsApiKey || null,
      smsSenderId || null,
      autoSendBillSms ? 1 : 0,
      autoSendAppointmentSms ? 1 : 0
    );

    res.json({ success: true, message: 'Hardware and gateway preferences saved' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to update settings' });
  }
}

export function getServiceSummary(req: AuthenticatedRequest, res: Response): void {
  try {
    const businessId = req.businessId!;

    const today = new Date().toISOString().split('T')[0];
    const aptRow = db.prepare(`
      SELECT 
        COUNT(*) as total_today,
        SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed_today
      FROM service_appointments
      WHERE business_id = ? AND appointment_date = ?
    `).get(businessId, today) as any;

    const jobRow = db.prepare(`
      SELECT 
        COUNT(*) as total_jobs,
        SUM(CASE WHEN status = 'PENDING' OR status = 'IN_PROGRESS' THEN 1 ELSE 0 END) as active_jobs
      FROM service_records
      WHERE business_id = ?
    `).get(businessId) as any;

    const recRow = db.prepare(`
      SELECT COUNT(*) as count, SUM(amount_paise) as total_recurring_paise
      FROM recurring_invoices
      WHERE business_id = ? AND status = 'ACTIVE'
    `).get(businessId) as any;

    res.json({
      summary: {
        appointmentsToday: aptRow?.total_today || 0,
        appointmentsCompleted: aptRow?.completed_today || 0,
        activeJobCards: jobRow?.active_jobs || 0,
        totalJobCards: jobRow?.total_jobs || 0,
        activeContracts: recRow?.count || 0,
        monthlyRecurringRevenue: (recRow?.total_recurring_paise || 0) / 100,
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch service summary' });
  }
}
