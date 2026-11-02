"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadAndRestore = exports.restoreBackup = exports.createBackupSnapshot = void 0;
exports.exportBackup = exportBackup;
exports.getBackups = getBackups;
exports.verifyBackup = verifyBackup;
exports.deleteBackup = deleteBackup;
exports.getBackupSettings = getBackupSettings;
exports.updateBackupSettings = updateBackupSettings;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const zod_1 = require("zod");
const connection_js_1 = require("../../db/connection.js");
const http_js_1 = require("../../lib/http.js");
const index_js_1 = require("../../config/index.js");
const migrations_js_1 = require("../../db/migrations.js");
const backupService = __importStar(require("../../services/backupService.js"));
const auditService_js_1 = require("../../services/auditService.js");
/** Full JSON export of every table that belongs to this business (data portability). */
function exportBackup(req, res) {
    const businessId = req.businessId;
    const tables = connection_js_1.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((t) => t.name);
    const data = {};
    for (const t of tables) {
        const cols = connection_js_1.db.prepare(`PRAGMA table_info("${t}")`).all().map((c) => c.name);
        if (!cols.includes('business_id'))
            continue;
        data[t] = connection_js_1.db.prepare(`SELECT * FROM "${t}" WHERE business_id = ?`).all(businessId);
    }
    data.businesses = [connection_js_1.db.prepare('SELECT * FROM businesses WHERE id = ?').get(businessId)];
    (0, auditService_js_1.logAudit)({ businessId, userId: req.user?.userId, action: 'DATA_EXPORTED', entityType: 'BACKUP' });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="apna-billing-export-${Date.now()}.json"`);
    res.send(JSON.stringify({
        metadata: { platform: 'Apna Billing', appVersion: index_js_1.APP_VERSION, schemaVersion: (0, migrations_js_1.getSchemaVersion)(connection_js_1.db), exported_at: new Date().toISOString(), business_id: businessId },
        data,
    }));
}
exports.createBackupSnapshot = (0, http_js_1.asyncHandler)(async (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 120) : '';
    const backup = await backupService.createBackup({ kind: 'MANUAL', userId: req.user?.userId, notes: name || 'Manual backup' });
    (0, auditService_js_1.logAudit)({ businessId: req.businessId, userId: req.user?.userId, action: 'BACKUP_CREATED', entityType: 'BACKUP', entityId: backup.id,
        details: { file: backup.file_name, sizeBytes: backup.size_bytes } });
    res.status(201).json({ message: 'Backup created and verified', backup });
});
function getBackups(req, res) {
    res.json({ backups: backupService.listBackups(), settings: backupService.getBackupSettings() });
}
function verifyBackup(req, res) {
    res.json({ backup: backupService.verifyBackup(req.params.id) });
}
function deleteBackup(req, res) {
    backupService.deleteBackup(req.params.id);
    (0, auditService_js_1.logAudit)({ businessId: req.businessId, userId: req.user?.userId, action: 'BACKUP_DELETED', entityType: 'BACKUP', entityId: req.params.id });
    res.json({ message: 'Backup deleted' });
}
const restoreSchema = zod_1.z.object({
    backupId: zod_1.z.string().max(64).optional(),
    filePath: zod_1.z.string().max(1024).optional(),
}).refine((v) => v.backupId || v.filePath, 'Provide backupId or filePath');
exports.restoreBackup = (0, http_js_1.asyncHandler)(async (req, res) => {
    const input = (0, http_js_1.parse)(restoreSchema, req.body);
    const result = input.backupId
        ? await backupService.restoreBackupById(input.backupId, req.user?.userId)
        : await backupService.restoreFromFile(input.filePath, req.user?.userId);
    res.json({ message: 'Backup restored successfully. A safety backup of the previous data was created first.', details: result });
});
/** Restore from a .db file uploaded as the raw request body (application/octet-stream). */
exports.uploadAndRestore = (0, http_js_1.asyncHandler)(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length < 100)
        throw new http_js_1.HttpError(400, 'NO_FILE', 'Upload a backup .db file');
    if (req.body.subarray(0, 15).toString('utf8') !== 'SQLite format 3')
        throw new http_js_1.HttpError(400, 'INVALID_BACKUP_FILE', 'File is not a SQLite database');
    const { backupDir } = backupService.getBackupSettings();
    fs_1.default.mkdirSync(backupDir, { recursive: true });
    const dest = path_1.default.join(backupDir, `uploaded-${Date.now()}-${crypto_1.default.randomBytes(3).toString('hex')}.db`);
    fs_1.default.writeFileSync(dest, req.body);
    const result = await backupService.restoreFromFile(dest, req.user?.userId);
    res.json({ message: 'Backup restored successfully. A safety backup of the previous data was created first.', details: result });
});
function getBackupSettings(req, res) {
    res.json({ settings: backupService.getBackupSettings() });
}
function updateBackupSettings(req, res) {
    const input = (0, http_js_1.parse)(zod_1.z.object({
        backupDir: zod_1.z.string().trim().min(1).max(1024).optional(),
        autoBackupEnabled: zod_1.z.boolean().optional(),
        autoBackupIntervalHours: zod_1.z.coerce.number().min(1).max(168).optional(),
        keepAutoBackups: zod_1.z.coerce.number().int().min(1).max(365).optional(),
    }), req.body);
    const settings = backupService.updateBackupSettings(input);
    (0, auditService_js_1.logAudit)({ businessId: req.businessId, userId: req.user?.userId, action: 'BACKUP_SETTINGS_UPDATED', entityType: 'BACKUP', details: input });
    res.json({ message: 'Backup settings saved', settings });
}
