"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const index_js_1 = require("./config/index.js");
const routes_js_1 = __importDefault(require("./routes.js"));
const seed_js_1 = require("./db/seed.js");
const app = (0, express_1.default)();
app.use((0, cors_1.default)({
    origin: '*',
    credentials: true,
}));
app.use(express_1.default.json());
// Request logger for API calls
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        if (req.path.startsWith('/api')) {
            console.log(`[API] ${req.method} ${req.path} -> ${res.statusCode} (${duration}ms)`);
        }
    });
    next();
});
// Root health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', name: 'Apna Billing API', version: '1.0.0', time: new Date().toISOString() });
});
// API routes under /api/v1
app.use('/api/v1', routes_js_1.default);
// Global Error Handler
app.use((err, req, res, next) => {
    console.error('[Error]', err);
    res.status(err.status || 500).json({
        code: err.code || 'INTERNAL_ERROR',
        message: err.message || 'An unexpected error occurred',
        details: index_js_1.config.isDev ? err.stack : undefined,
    });
});
// Seed DB on start
(0, seed_js_1.runSeed)();
app.listen(index_js_1.config.port, () => {
    console.log(`🚀 Apna Billing backend server running on http://localhost:${index_js_1.config.port}`);
});
