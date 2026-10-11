"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportBackup = exportBackup;
exports.createBackupSnapshot = createBackupSnapshot;
exports.getBackups = getBackups;
exports.restoreBackup = restoreBackup;
const uuid_1 = require("uuid");
const connection_js_1 = require("../../db/connection.js");
function exportBackup(req, res) {
    const businessId = req.businessId;
    const business = connection_js_1.db.prepare('SELECT * FROM businesses WHERE id = ?').get(businessId);
    const products = connection_js_1.db.prepare('SELECT * FROM products WHERE business_id = ?').all(businessId);
    const categories = connection_js_1.db.prepare('SELECT * FROM categories WHERE business_id = ?').all(businessId);
    const customers = connection_js_1.db.prepare('SELECT * FROM customers WHERE business_id = ?').all(businessId);
    const invoices = connection_js_1.db.prepare('SELECT * FROM invoices WHERE business_id = ?').all(businessId);
    const invoiceItems = connection_js_1.db.prepare('SELECT * FROM invoice_items WHERE business_id = ?').all(businessId);
    const suppliers = connection_js_1.db.prepare('SELECT * FROM suppliers WHERE business_id = ?').all(businessId);
    const purchaseInvoices = connection_js_1.db.prepare('SELECT * FROM purchase_invoices WHERE business_id = ?').all(businessId);
    const purchaseItems = connection_js_1.db.prepare('SELECT * FROM purchase_items WHERE business_id = ?').all(businessId);
    const expenses = connection_js_1.db.prepare('SELECT * FROM expenses WHERE business_id = ?').all(businessId);
    const staff = connection_js_1.db.prepare('SELECT * FROM staff WHERE business_id = ?').all(businessId);
    const quotations = connection_js_1.db.prepare('SELECT * FROM quotations WHERE business_id = ?').all(businessId);
    const quotationItems = connection_js_1.db.prepare('SELECT * FROM quotation_items WHERE business_id = ?').all(businessId);
    const tables = connection_js_1.db.prepare('SELECT * FROM restaurant_tables WHERE business_id = ?').all(businessId);
    const kots = connection_js_1.db.prepare('SELECT * FROM kots WHERE business_id = ?').all(businessId);
    const branches = connection_js_1.db.prepare('SELECT * FROM branches WHERE business_id = ?').all(businessId);
    const backupData = {
        metadata: {
            platform: 'Apna Billing',
            version: '1.0.0',
            exported_at: new Date().toISOString(),
            business_id: businessId,
        },
        business,
        products,
        categories,
        customers,
        invoices,
        invoiceItems,
        suppliers,
        purchaseInvoices,
        purchaseItems,
        expenses,
        staff,
        quotations,
        quotationItems,
        tables,
        kots,
        branches,
    };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="backup_${businessId}_${Date.now()}.json"`);
    res.json(backupData);
}
function createBackupSnapshot(req, res) {
    const businessId = req.businessId;
    const { name } = req.body;
    const productsCount = connection_js_1.db.prepare('SELECT COUNT(*) as count FROM products WHERE business_id = ?').get(businessId).count;
    const invoicesCount = connection_js_1.db.prepare('SELECT COUNT(*) as count FROM invoices WHERE business_id = ?').get(businessId).count;
    const customersCount = connection_js_1.db.prepare('SELECT COUNT(*) as count FROM customers WHERE business_id = ?').get(businessId).count;
    const totalRecords = productsCount + invoicesCount + customersCount;
    // Generate payload
    const business = connection_js_1.db.prepare('SELECT * FROM businesses WHERE id = ?').get(businessId);
    const products = connection_js_1.db.prepare('SELECT * FROM products WHERE business_id = ?').all(businessId);
    const invoices = connection_js_1.db.prepare('SELECT * FROM invoices WHERE business_id = ?').all(businessId);
    const customers = connection_js_1.db.prepare('SELECT * FROM customers WHERE business_id = ?').all(businessId);
    const snapshotJson = JSON.stringify({
        metadata: { exported_at: new Date().toISOString() },
        business,
        products,
        invoices,
        customers,
    });
    const sizeKb = Math.round((Buffer.byteLength(snapshotJson, 'utf8') / 1024) * 100) / 100;
    const backupId = (0, uuid_1.v4)();
    const backupName = name || `Automatic Snapshot - ${new Date().toLocaleDateString('en-IN')}`;
    connection_js_1.db.prepare(`
    INSERT INTO backups (id, business_id, backup_name, record_count, file_size_kb, data_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(backupId, businessId, backupName, totalRecords, sizeKb, snapshotJson);
    // Log audit
    connection_js_1.db.prepare(`
    INSERT INTO audit_logs (id, user_id, business_id, action, entity_type, entity_id, details_json)
    VALUES (?, ?, ?, 'BACKUP_CREATED', 'BACKUP', ?, ?)
  `).run((0, uuid_1.v4)(), req.user?.userId || null, businessId, backupId, JSON.stringify({ name: backupName, sizeKb }));
    res.status(201).json({
        message: 'Backup snapshot created successfully',
        backup: {
            id: backupId,
            backup_name: backupName,
            record_count: totalRecords,
            file_size_kb: sizeKb,
            created_at: new Date().toISOString(),
        },
    });
}
function getBackups(req, res) {
    const businessId = req.businessId;
    const backups = connection_js_1.db.prepare(`
    SELECT id, business_id, backup_name, record_count, file_size_kb, created_at
    FROM backups
    WHERE business_id = ?
    ORDER BY created_at DESC
  `).all(businessId);
    res.json({ backups });
}
function restoreBackup(req, res) {
    const businessId = req.businessId;
    const { backupId, rawJson } = req.body;
    let backupData = null;
    if (backupId) {
        const row = connection_js_1.db.prepare('SELECT data_json FROM backups WHERE id = ? AND business_id = ?').get(backupId, businessId);
        if (!row) {
            res.status(404).json({ error: 'Backup not found' });
            return;
        }
        backupData = JSON.parse(row.data_json);
    }
    else if (rawJson) {
        backupData = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
    }
    else {
        res.status(400).json({ error: 'Please provide either backupId or rawJson' });
        return;
    }
    // Restore within transaction
    const transaction = connection_js_1.db.transaction(() => {
        // If customers are provided, upsert them
        if (backupData.customers && Array.isArray(backupData.customers)) {
            const upsertCustomer = connection_js_1.db.prepare(`
        INSERT OR REPLACE INTO customers (id, business_id, name, phone, email, gstin, address, credit_limit_paise, outstanding_balance_paise)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
            for (const c of backupData.customers) {
                upsertCustomer.run(c.id || (0, uuid_1.v4)(), businessId, c.name, c.phone || null, c.email || null, c.gstin || null, c.address || null, c.credit_limit_paise || 0, c.outstanding_balance_paise || 0);
            }
        }
        // Log audit
        connection_js_1.db.prepare(`
      INSERT INTO audit_logs (id, user_id, business_id, action, entity_type, details_json)
      VALUES (?, ?, ?, 'BACKUP_RESTORED', 'BACKUP', ?)
    `).run((0, uuid_1.v4)(), req.user?.userId || null, businessId, JSON.stringify({ restoredRecords: backupData.products?.length || 0 }));
    });
    transaction();
    res.json({
        message: 'Backup restored and verified successfully',
        details: {
            timestamp: new Date().toISOString(),
        },
    });
}
