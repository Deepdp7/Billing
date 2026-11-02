"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = exports.APP_VERSION = exports.APP_NAME = void 0;
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const fs_1 = __importDefault(require("fs"));
const crypto_1 = __importDefault(require("crypto"));
const dotenv_1 = __importDefault(require("dotenv"));
// The packaged desktop app (APNA_EMBEDDED=1) never reads a .env file: one dropped next to the EXE must not be able
// to switch licensing off or change where data lives.
const embedded = process.env.APNA_EMBEDDED === '1';
if (!embedded)
    dotenv_1.default.config();
exports.APP_NAME = 'ApnaBilling';
exports.APP_VERSION = process.env.APNA_APP_VERSION || '1.1.0';
const isProduction = embedded || process.env.NODE_ENV === 'production';
/**
 * Resolve the per-installation data directory.
 * Production data never lives next to the executable, so reinstalling or upgrading the
 * application cannot overwrite customer data.
 *   Windows: %APPDATA%/ApnaBilling/data
 *   macOS:   ~/Library/Application Support/ApnaBilling/data
 *   Linux:   ~/.local/share/ApnaBilling/data
 */
function resolveDataDir() {
    if (process.env.APNA_DATA_DIR)
        return path_1.default.resolve(process.env.APNA_DATA_DIR);
    if (process.env.DB_PATH)
        return path_1.default.dirname(path_1.default.resolve(process.env.DB_PATH));
    if (!isProduction)
        return path_1.default.resolve(process.cwd(), 'data');
    let base;
    if (process.platform === 'win32') {
        base = process.env.APPDATA || path_1.default.join(os_1.default.homedir(), 'AppData', 'Roaming');
    }
    else if (process.platform === 'darwin') {
        base = path_1.default.join(os_1.default.homedir(), 'Library', 'Application Support');
    }
    else {
        base = process.env.XDG_DATA_HOME || path_1.default.join(os_1.default.homedir(), '.local', 'share');
    }
    return path_1.default.join(base, exports.APP_NAME, 'data');
}
const dataDir = resolveDataDir();
fs_1.default.mkdirSync(dataDir, { recursive: true });
/**
 * Each installation gets its own randomly generated JWT secret, stored in its data directory.
 * A hard-coded secret would let a token minted on one install be accepted by every other install.
 */
function resolveJwtSecret() {
    if (process.env.JWT_SECRET)
        return process.env.JWT_SECRET;
    const secretPath = path_1.default.join(dataDir, '.jwt-secret');
    try {
        const existing = fs_1.default.readFileSync(secretPath, 'utf8').trim();
        if (existing.length >= 32)
            return existing;
    }
    catch {
        // first run
    }
    const secret = crypto_1.default.randomBytes(48).toString('hex');
    fs_1.default.writeFileSync(secretPath, secret, { mode: 0o600 });
    return secret;
}
const demoFlag = process.env.APNA_DEMO_MODE;
exports.config = {
    port: parseInt(process.env.PORT || '5000', 10),
    // Bind to loopback only: the API must not be reachable from other machines on the shop network.
    host: process.env.HOST || '127.0.0.1',
    jwtSecret: resolveJwtSecret(),
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
    dataDir,
    dbPath: process.env.DB_PATH ? path_1.default.resolve(process.env.DB_PATH) : path_1.default.join(dataDir, 'apna_billing.db'),
    backupDir: process.env.APNA_BACKUP_DIR ? path_1.default.resolve(process.env.APNA_BACKUP_DIR) : path_1.default.join(dataDir, 'backups'),
    isDev: !isProduction,
    // Demo businesses and quick-login accounts are only created when explicitly requested,
    // or in local development unless turned off.
    demoMode: !embedded && (demoFlag === '1' || (!isProduction && demoFlag !== '0')),
    // A desktop install hosts exactly one business; self-registration closes after first setup.
    singleTenant: embedded || (process.env.APNA_SINGLE_TENANT ? process.env.APNA_SINGLE_TENANT === '1' : isProduction),
    // Directory holding the built client (served by Express in production / desktop).
    clientDistDir: process.env.APNA_CLIENT_DIST || path_1.default.resolve(process.cwd(), '..', 'client', 'dist'),
    licensing: {
        serverUrl: (process.env.APNA_LICENSE_SERVER_URL || 'http://127.0.0.1:7000').replace(/\/$/, ''),
        // Set to '0' only for local development without a license server.
        enforce: embedded || (process.env.APNA_LICENSE_ENFORCE ? process.env.APNA_LICENSE_ENFORCE === '1' : isProduction),
        syncIntervalMs: parseInt(process.env.APNA_LICENSE_SYNC_MS || String(6 * 60 * 60 * 1000), 10),
    },
};
