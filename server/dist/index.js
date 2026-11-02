"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startServer = startServer;
exports.stopServer = stopServer;
const index_js_1 = require("./config/index.js");
const app_js_1 = require("./app.js");
const seed_js_1 = require("./db/seed.js");
const jobs_js_1 = require("./jobs.js");
/**
 * Start the local API server. Used by `npm run dev`/`npm start` and by the Electron main process,
 * which passes port 0 to get a free port and then loads http://127.0.0.1:<port>.
 */
function startServer(port = index_js_1.config.port) {
    if (index_js_1.config.demoMode) {
        (0, seed_js_1.runSeed)();
    }
    const app = (0, app_js_1.createApp)();
    return new Promise((resolve, reject) => {
        const server = app.listen(port, index_js_1.config.host, () => {
            const actualPort = server.address().port;
            console.log(`Apna Billing local server running on http://${index_js_1.config.host}:${actualPort}`);
            (0, jobs_js_1.startBackgroundJobs)();
            resolve({ server, port: actualPort });
        });
        server.on('error', reject);
    });
}
function stopServer(server) {
    (0, jobs_js_1.stopBackgroundJobs)();
    return new Promise((resolve) => server.close(() => resolve()));
}
// Run directly (not when required by Electron or tests).
const isDirectRun = (() => {
    const entry = process.argv[1] || '';
    return /[\\/]index\.(ts|js)$/.test(entry) && !process.env.APNA_EMBEDDED;
})();
if (isDirectRun) {
    startServer().catch((err) => {
        console.error('Failed to start server:', err);
        process.exit(1);
    });
}
