/**
 * Apna Billing desktop shell (Electron main process).
 *
 * Runs the local Express API in-process on 127.0.0.1 (random free port) and shows the React UI in a window.
 * Customer data lives in %APPDATA%/ApnaBilling/data — never inside the installation folder — so updates and
 * reinstalls keep it. The window has no Node access; the only bridge is "save as PDF" (see preload.cjs).
 */
const { app, BrowserWindow, dialog, ipcMain, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

const APP_ROOT = path.join(__dirname, 'app');
const buildConfig = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'config.json'), 'utf8')); } catch { return {}; }
})();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let mainWindow = null;
  let server = null;
  let origin = '';

  // ---- Environment for the embedded server (set before it is loaded) ----
  // Remove anything that could weaken licensing or redirect data; the server also ignores these when embedded.
  for (const k of ['APNA_LICENSE_ENFORCE', 'APNA_DEMO_MODE', 'APNA_SINGLE_TENANT', 'DB_PATH', 'JWT_SECRET', 'APNA_DATA_DIR', 'APNA_CLIENT_DIST']) {
    delete process.env[k];
  }
  // --apna-data-dir=<path> runs against a separate data folder (testing, or a portable install). It cannot bypass
  // licensing: a new folder is a new installation that must be activated on its own.
  const dirArg = process.argv.find((a) => a.startsWith('--apna-data-dir='));
  const dataDir = dirArg ? path.resolve(dirArg.slice('--apna-data-dir='.length)) : path.join(app.getPath('appData'), 'ApnaBilling', 'data');
  Object.assign(process.env, {
    NODE_ENV: 'production',
    APNA_EMBEDDED: '1',
    APNA_DATA_DIR: dataDir,
    APNA_CLIENT_DIST: path.join(APP_ROOT, 'client'),
    APNA_APP_VERSION: app.getVersion(),
    APNA_LICENSE_SERVER_URL: buildConfig.licenseServerUrl || 'https://license.apnabilling.example',
  });

  function createWindow() {
    mainWindow = new BrowserWindow({
      width: 1366,
      height: 860,
      minWidth: 1024,
      minHeight: 680,
      title: 'Apna Billing',
      backgroundColor: '#020617',
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
      },
    });
    mainWindow.once('ready-to-show', () => mainWindow.show());

    // Only the local app may load in this window; external links open in the user's browser.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url) && !url.startsWith(origin)) shell.openExternal(url);
      return { action: 'deny' };
    });
    mainWindow.webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith(origin)) {
        event.preventDefault();
        if (/^https?:\/\//.test(url)) shell.openExternal(url);
      }
    });
    mainWindow.loadURL(origin);
  }

  async function backupIfVersionChanged() {
    // Database migrations already back up before schema changes; this also covers app-only upgrades.
    const marker = path.join(dataDir, 'last-app-version.txt');
    let last = '';
    try { last = fs.readFileSync(marker, 'utf8').trim(); } catch { /* first run */ }
    if (last && last !== app.getVersion()) {
      try {
        const backup = require(path.join(APP_ROOT, 'server', 'services', 'backupService.js'));
        await backup.createBackup({ kind: 'PRE_MIGRATION', notes: `Before running version ${app.getVersion()} (was ${last})` });
      } catch (err) {
        console.error('Pre-upgrade backup failed', err);
      }
    }
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(marker, app.getVersion());
  }

  ipcMain.handle('apna:save-pdf', async (event, fileName) => {
    const safeName = String(fileName || 'document.pdf').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 120);
    const win = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Save as PDF',
      defaultPath: path.join(app.getPath('documents'), safeName.endsWith('.pdf') ? safeName : `${safeName}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) return { saved: false };
    const pdf = await event.sender.printToPDF({ printBackground: true, pageSize: 'A4', margins: { marginType: 'default' } });
    fs.writeFileSync(filePath, pdf);
    return { saved: true, path: filePath };
  });

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'File', submenu: [{ role: 'reload' }, { type: 'separator' }, { role: 'quit' }] },
      { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: 'View', submenu: [{ role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
      { label: 'Help', submenu: [{ label: `Apna Billing ${app.getVersion()}`, enabled: false }, { label: 'Open data folder', click: () => shell.openPath(dataDir) }] },
    ]));
    try {
      const { startServer } = require(path.join(APP_ROOT, 'server', 'index.js'));
      const started = await startServer(0);
      server = started.server;
      origin = `http://127.0.0.1:${started.port}`;
      await backupIfVersionChanged();
      createWindow();
    } catch (err) {
      dialog.showErrorBox('Apna Billing could not start', `${err && err.message ? err.message : err}\n\nYour data is safe in:\n${dataDir}`);
      app.quit();
    }
  });

  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => {
    if (server) {
      try {
        require(path.join(APP_ROOT, 'server', 'jobs.js')).stopBackgroundJobs();
        server.close();
      } catch { /* shutting down */ }
    }
  });
}
