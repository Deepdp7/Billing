"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
exports.config = {
    port: parseInt(process.env.PORT || '5000', 10),
    jwtSecret: process.env.JWT_SECRET || 'apna-billing-super-secret-key-2026-production',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
    dbPath: process.env.DB_PATH || path_1.default.resolve(process.cwd(), 'data', 'apna_billing.db'),
    isDev: process.env.NODE_ENV !== 'production',
};
