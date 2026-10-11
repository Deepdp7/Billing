import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../db/connection.js';
import { AuthenticatedRequest } from '../../middleware/auth.js';

export function getTickets(req: AuthenticatedRequest, res: Response): void {
  const isSuperAdmin = req.user?.role === 'SUPER_ADMIN';
  const businessId = req.businessId;

  let tickets;
  if (isSuperAdmin) {
    tickets = db.prepare(`
      SELECT st.*, b.name as business_name, u.name as user_name, u.email as user_email
      FROM support_tickets st
      LEFT JOIN businesses b ON st.business_id = b.id
      LEFT JOIN users u ON st.user_id = u.id
      ORDER BY st.created_at DESC
    `).all();
  } else {
    tickets = db.prepare(`
      SELECT st.*, u.name as user_name
      FROM support_tickets st
      LEFT JOIN users u ON st.user_id = u.id
      WHERE st.business_id = ?
      ORDER BY st.created_at DESC
    `).all(businessId);
  }

  res.json({ tickets });
}

export function createTicket(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId!;
  const userId = req.user!.userId;
  const { subject, description, priority } = req.body;

  if (!subject || !description) {
    res.status(400).json({ error: 'Subject and description are required' });
    return;
  }

  const ticketId = uuidv4();
  db.prepare(`
    INSERT INTO support_tickets (id, business_id, user_id, subject, description, priority, status)
    VALUES (?, ?, ?, ?, ?, ?, 'OPEN')
  `).run(ticketId, businessId, userId, subject, description, priority || 'MEDIUM');

  const ticket = db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(ticketId);
  res.status(201).json({ ticket });
}

export function updateTicketStatus(req: AuthenticatedRequest, res: Response): void {
  const { id } = req.params;
  const { status } = req.body;

  db.prepare(`
    UPDATE support_tickets
    SET status = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(status || 'RESOLVED', id);

  const updated = db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(id);
  res.json({ ticket: updated });
}

export function getFaqs(req: AuthenticatedRequest, res: Response): void {
  const faqs = [
    {
      id: 'faq-1',
      category: 'GST & Invoicing',
      question: 'How is CGST and SGST calculated automatically in Apna Billing?',
      answer: 'When billing an intrastate sale (same state as your registered business), Apna Billing automatically splits the total tax rate 50/50 between CGST and SGST. For interstate sales, IGST is applied at the full rate.',
    },
    {
      id: 'faq-2',
      category: 'Hardware & Printers',
      question: 'How do I configure my 3-inch 80mm thermal receipt printer?',
      answer: 'Ensure your thermal printer is connected via USB. When finalizing any POS bill or clicking "Print Receipt", select "3-inch POS Thermal" mode. The system auto-formats font, paper width, and cutoff margins.',
    },
    {
      id: 'faq-3',
      category: 'Barcode Scanning',
      question: 'Do I need any specialized drivers for barcode scanners?',
      answer: 'No! Apna Billing POS works directly with any standard USB or Bluetooth HID barcode scanner (plug-and-play keyboard wedge). Simply scan a barcode and the product is instantly added to the active bill.',
    },
    {
      id: 'faq-4',
      category: 'Inventory & Stock',
      question: 'How does automatic inventory reduction work on bill creation?',
      answer: 'Every invoice save is wrapped inside an atomic SQLite ACID transaction. The quantity of each item is deducted from stock and an immutable audit ledger entry is appended to stock_movements.',
    },
    {
      id: 'faq-5',
      category: 'Restaurant & Dining',
      question: 'How do KOTs (Kitchen Order Tickets) differ from tax invoices?',
      answer: 'KOT is sent directly to the kitchen display or printed on the kitchen thermal printer with items, notes, and table number without tax details. Once diners finish eating, the table can be billed as a single final tax invoice.',
    },
  ];

  res.json({ faqs });
}
