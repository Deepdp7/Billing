import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../db/connection.js';
import { AuthenticatedRequest } from '../../middleware/auth.js';

// ================= RESTAURANT TABLES & KOT =================
export function getTables(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId;
  const tables = db.prepare('SELECT * FROM restaurant_tables WHERE business_id = ? ORDER BY table_number ASC').all(businessId);
  res.json({ data: tables });
}

export function createTable(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId;
  const { tableNumber, capacity = 4 } = req.body;

  const id = uuidv4();
  db.prepare(`
    INSERT INTO restaurant_tables (id, business_id, table_number, capacity, status, created_at)
    VALUES (?, ?, ?, ?, 'VACANT', datetime('now'))
  `).run(id, businessId, tableNumber, Number(capacity));

  res.status(201).json({ message: 'Table created' });
}

export function updateTableStatus(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId;
  const { id } = req.params;
  const { status } = req.body;

  db.prepare('UPDATE restaurant_tables SET status = ? WHERE id = ? AND business_id = ?').run(status, id, businessId);
  res.json({ message: `Table status updated to ${status}` });
}

export function getKots(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId;
  const kots = db.prepare('SELECT * FROM kots WHERE business_id = ? ORDER BY created_at DESC LIMIT 50').all(businessId);
  res.json({
    data: kots.map((k: any) => ({
      ...k,
      items: JSON.parse(k.items_json || '[]'),
    })),
  });
}

export function createKot(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId;
  const { tableNumber, items = [] } = req.body;

  const id = uuidv4();
  const kotNumber = `KOT-${Date.now().toString().slice(-4)}`;

  db.prepare(`
    INSERT INTO kots (id, business_id, kot_number, table_number, items_json, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'PENDING', datetime('now'))
  `).run(id, businessId, kotNumber, tableNumber, JSON.stringify(items));

  // Also set table to OCCUPIED
  db.prepare("UPDATE restaurant_tables SET status = 'OCCUPIED' WHERE table_number = ? AND business_id = ?").run(tableNumber, businessId);

  res.status(201).json({ message: 'KOT generated successfully', kotNumber });
}

export function updateKotStatus(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId;
  const { id } = req.params;
  const { status } = req.body;

  db.prepare('UPDATE kots SET status = ? WHERE id = ? AND business_id = ?').run(status, id, businessId);
  res.json({ message: `KOT status updated to ${status}` });
}

// ================= PHARMACY NEAR-EXPIRY MONITORING =================
export function getPharmacyExpiryMonitoring(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId;
  const products = db.prepare(`
    SELECT id, name, sku, stock_quantity, extra_attributes_json
    FROM products 
    WHERE business_id = ? AND is_active = 1
  `).all(businessId) as any[];

  const batches = products
    .filter(p => p.extra_attributes_json)
    .map(p => {
      const extra = JSON.parse(p.extra_attributes_json || '{}');
      return {
        id: p.id,
        name: p.name,
        sku: p.sku,
        stockQuantity: p.stock_quantity,
        batchNo: extra.batch_no || 'N/A',
        expiryDate: extra.expiry_date || null,
        composition: extra.composition || 'N/A',
      };
    })
    .filter(b => b.expiryDate);

  res.json({ data: batches });
}

// ================= IN-APP NOTIFICATIONS =================
export function getNotifications(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId;
  const notifications = db.prepare('SELECT * FROM notifications WHERE business_id = ? ORDER BY created_at DESC LIMIT 30').all(businessId);
  res.json({ data: notifications });
}

export function markNotificationRead(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId;
  const { id } = req.params;
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND business_id = ?').run(id, businessId);
  res.json({ message: 'Notification marked as read' });
}
