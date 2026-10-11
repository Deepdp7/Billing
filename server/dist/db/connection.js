"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = void 0;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const index_js_1 = require("../config/index.js");
const schema_js_1 = require("./schema.js");
const dbDir = path_1.default.dirname(index_js_1.config.dbPath);
if (!fs_1.default.existsSync(dbDir)) {
    fs_1.default.mkdirSync(dbDir, { recursive: true });
}
exports.db = new better_sqlite3_1.default(index_js_1.config.dbPath, {
// verbose: config.isDev ? console.log : undefined,
});
// Configure SQLite for high performance and integrity
exports.db.pragma('foreign_keys = ON');
exports.db.pragma('journal_mode = WAL');
exports.db.pragma('synchronous = NORMAL');
// Run schema initialization
exports.db.exec(schema_js_1.SCHEMA_SQL);
console.log(`[Database] SQLite connected & initialized at: ${index_js_1.config.dbPath}`);
