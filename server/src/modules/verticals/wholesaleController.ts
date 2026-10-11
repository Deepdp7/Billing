import { Response } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth.js';
import { db } from '../../db/connection.js';
import { v4 as uuidv4 } from 'uuid';

// --- Bulk Pricing Slabs ---
export function getBulkSlabs(req: AuthenticatedRequest, res: Response): void {
  try {
    const businessId = req.businessId!;
    const productId = req.query.productId as string | undefined;

    let query = `
      SELECT bps.*, p.name as product_name, p.sku as product_sku, p.sale_price_paise as standard_price_paise
      FROM bulk_price_slabs bps
      JOIN products p ON bps.product_id = p.id
      WHERE bps.business_id = ?
    `;
    const params: any[] = [businessId];

    if (productId) {
      query += ` AND bps.product_id = ?`;
      params.push(productId);
    }

    query += ` ORDER BY p.name ASC, bps.min_quantity ASC`;

    const rows = db.prepare(query).all(...params) as any[];

    res.json({
      slabs: rows.map(r => ({
        id: r.id,
        productId: r.product_id,
        productName: r.product_name,
        productSku: r.product_sku,
        standardPrice: (r.standard_price_paise || 0) / 100,
        minQuantity: r.min_quantity,
        maxQuantity: r.max_quantity,
        slabPrice: (r.slab_price_paise || 0) / 100,
        createdAt: r.created_at,
      }))
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch bulk pricing slabs' });
  }
}

export function createBulkSlab(req: AuthenticatedRequest, res: Response): void {
  try {
    const businessId = req.businessId!;
    const { productId, minQuantity, maxQuantity, slabPrice } = req.body;

    if (!productId || minQuantity === undefined || slabPrice === undefined) {
      res.status(400).json({ error: 'Product ID, min quantity and slab price are required' });
      return;
    }

    const id = `slab_${uuidv4()}`;
    const slabPricePaise = Math.round(Number(slabPrice) * 100);

    db.prepare(`
      INSERT INTO bulk_price_slabs (id, business_id, product_id, min_quantity, max_quantity, slab_price_paise)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, businessId, productId, Number(minQuantity), maxQuantity ? Number(maxQuantity) : null, slabPricePaise);

    res.status(201).json({
      success: true,
      slab: {
        id,
        productId,
        minQuantity: Number(minQuantity),
        maxQuantity: maxQuantity ? Number(maxQuantity) : null,
        slabPrice: Number(slabPrice)
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to create bulk pricing slab' });
  }
}

export function deleteBulkSlab(req: AuthenticatedRequest, res: Response): void {
  try {
    const businessId = req.businessId!;
    const { id } = req.params;

    db.prepare(`DELETE FROM bulk_price_slabs WHERE id = ? AND business_id = ?`).run(id, businessId);
    res.json({ success: true, message: 'Bulk slab deleted' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to delete bulk slab' });
  }
}

// --- Distribution Routes ---
export function getDistributorRoutes(req: AuthenticatedRequest, res: Response): void {
  try {
    const businessId = req.businessId!;
    const routes = db.prepare(`
      SELECT * FROM distributor_routes WHERE business_id = ? ORDER BY route_name ASC
    `).all(businessId) as any[];

    res.json({
      routes: routes.map(r => ({
        id: r.id,
        routeName: r.route_name,
        salespersonName: r.salesperson_name,
        areaZone: r.area_zone,
        createdAt: r.created_at,
      }))
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch routes' });
  }
}

export function createDistributorRoute(req: AuthenticatedRequest, res: Response): void {
  try {
    const businessId = req.businessId!;
    const { routeName, salespersonName, areaZone } = req.body;

    if (!routeName) {
      res.status(400).json({ error: 'Route name is required' });
      return;
    }

    const id = `route_${uuidv4()}`;
    db.prepare(`
      INSERT INTO distributor_routes (id, business_id, route_name, salesperson_name, area_zone)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, businessId, routeName, salespersonName || null, areaZone || null);

    res.status(201).json({
      success: true,
      route: { id, routeName, salespersonName, areaZone }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to create route' });
  }
}

// --- Wholesale Party Ledger & Credit Limits ---
export function getPartyLedger(req: AuthenticatedRequest, res: Response): void {
  try {
    const businessId = req.businessId!;
    const { customerId } = req.params;

    const customer = db.prepare(`
      SELECT * FROM customers WHERE id = ? AND business_id = ?
    `).get(customerId, businessId) as any;

    if (!customer) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }

    const entries = db.prepare(`
      SELECT * FROM party_ledger_entries 
      WHERE customer_id = ? AND business_id = ?
      ORDER BY created_at DESC
      LIMIT 100
    `).all(customerId, businessId) as any[];

    res.json({
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        gstin: customer.gstin,
        customerType: customer.customer_type || 'RETAIL',
        creditLimit: (customer.credit_limit_paise || 0) / 100,
        creditDays: customer.credit_days || 30,
        outstandingBalance: (customer.outstanding_balance_paise || 0) / 100,
        availableCredit: Math.max(0, ((customer.credit_limit_paise || 0) - (customer.outstanding_balance_paise || 0)) / 100),
      },
      entries: entries.map(e => ({
        id: e.id,
        entryType: e.entry_type,
        referenceNo: e.reference_no,
        debit: (e.debit_paise || 0) / 100,
        credit: (e.credit_paise || 0) / 100,
        runningBalance: (e.running_balance_paise || 0) / 100,
        notes: e.notes,
        createdAt: e.created_at,
      }))
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch party ledger' });
  }
}

export function addPartyLedgerEntry(req: AuthenticatedRequest, res: Response): void {
  try {
    const businessId = req.businessId!;
    const { customerId, entryType, referenceNo, amount, notes } = req.body;

    if (!customerId || !entryType || amount === undefined || Number(amount) <= 0) {
      res.status(400).json({ error: 'Customer ID, entry type, and valid amount required' });
      return;
    }

    const customer = db.prepare(`
      SELECT * FROM customers WHERE id = ? AND business_id = ?
    `).get(customerId, businessId) as any;

    if (!customer) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }

    const amountPaise = Math.round(Number(amount) * 100);
    const isDebit = entryType === 'INVOICE_DEBIT' || entryType === 'DEBIT_ADJUSTMENT';
    
    let currentBalance = customer.outstanding_balance_paise || 0;
    let newBalance = isDebit ? currentBalance + amountPaise : currentBalance - amountPaise;

    const entryId = `ledger_${uuidv4()}`;

    db.transaction(() => {
      db.prepare(`
        INSERT INTO party_ledger_entries (
          id, business_id, customer_id, entry_type, reference_no, debit_paise, credit_paise, running_balance_paise, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        entryId,
        businessId,
        customerId,
        entryType,
        referenceNo || null,
        isDebit ? amountPaise : 0,
        !isDebit ? amountPaise : 0,
        newBalance,
        notes || null
      );

      db.prepare(`
        UPDATE customers SET outstanding_balance_paise = ?, updated_at = datetime('now')
        WHERE id = ? AND business_id = ?
      `).run(newBalance, customerId, businessId);
    })();

    res.status(201).json({
      success: true,
      entry: {
        id: entryId,
        entryType,
        amount: Number(amount),
        runningBalance: newBalance / 100
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to add party ledger entry' });
  }
}

export function updateCustomerCredit(req: AuthenticatedRequest, res: Response): void {
  try {
    const businessId = req.businessId!;
    const { customerId } = req.params;
    const { creditLimit, creditDays, customerType } = req.body;

    const creditLimitPaise = Math.round(Number(creditLimit || 0) * 100);

    db.prepare(`
      UPDATE customers 
      SET credit_limit_paise = ?, credit_days = ?, customer_type = ?, updated_at = datetime('now')
      WHERE id = ? AND business_id = ?
    `).run(creditLimitPaise, Number(creditDays || 30), customerType || 'WHOLESALE', customerId, businessId);

    res.json({ success: true, message: 'Customer credit terms updated' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to update credit terms' });
  }
}

export function getWholesaleSummary(req: AuthenticatedRequest, res: Response): void {
  try {
    const businessId = req.businessId!;

    const partyStats = db.prepare(`
      SELECT 
        COUNT(*) as total_dealers,
        SUM(credit_limit_paise) as total_credit_extended_paise,
        SUM(outstanding_balance_paise) as total_receivables_paise
      FROM customers
      WHERE business_id = ? AND (customer_type = 'WHOLESALE' OR customer_type = 'DISTRIBUTOR')
    `).get(businessId) as any;

    const totalSlabs = db.prepare(`
      SELECT COUNT(*) as count FROM bulk_price_slabs WHERE business_id = ?
    `).get(businessId) as any;

    const totalRoutes = db.prepare(`
      SELECT COUNT(*) as count FROM distributor_routes WHERE business_id = ?
    `).get(businessId) as any;

    res.json({
      summary: {
        totalDealers: partyStats?.total_dealers || 0,
        totalCreditLimit: (partyStats?.total_credit_extended_paise || 0) / 100,
        totalReceivables: (partyStats?.total_receivables_paise || 0) / 100,
        activeBulkSlabs: totalSlabs?.count || 0,
        distributionRoutes: totalRoutes?.count || 0,
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to get wholesale summary' });
  }
}
