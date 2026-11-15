"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const index_js_1 = require("../config/index.js");
const migrations_js_1 = require("./migrations.js");
const sqlite_js_1 = require("./sqlite.js");
fs_1.default.mkdirSync(path_1.default.dirname(index_js_1.config.dbPath), { recursive: true });
(0, sqlite_js_1.ensureDatabaseEncrypted)(index_js_1.config.dbPath);
exports.db = (0, sqlite_js_1.openDatabase)(index_js_1.config.dbPath, (0, sqlite_js_1.databaseKey)());
exports.db.pragma('journal_mode = WAL');
exports.db.pragma('synchronous = NORMAL');
exports.db.pragma('foreign_keys = ON');
exports.db.pragma('busy_timeout = 5000');
const result = (0, migrations_js_1.runMigrations)(exports.db, {
    backupDir: index_js_1.config.backupDir,
    onBackup: (filePath, fromVersion) => {
        const stat = fs_1.default.statSync(filePath);
        const sha256 = crypto_1.default.createHash('sha256').update(fs_1.default.readFileSync(filePath)).digest('hex');
        exports.db.prepare(`
      INSERT INTO backup_history (id, file_name, file_path, size_bytes, sha256, kind, status, schema_version, notes)
      VALUES (?, ?, ?, ?, ?, 'PRE_MIGRATION', 'OK', ?, ?)
    `).run(crypto_1.default.randomUUID(), path_1.default.basename(filePath), filePath, stat.size, sha256, fromVersion, `Automatic backup before upgrading schema from v${fromVersion}`);
    },
});
console.log(`[Database] SQLite ready at ${index_js_1.config.dbPath} (schema v${result.to}${(0, sqlite_js_1.databaseKey)() ? ', encrypted' : ''})`);
