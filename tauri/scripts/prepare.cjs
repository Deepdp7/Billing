/**
 * Build what the Tauri shell runs.
 *
 *   node scripts/prepare.cjs --dev   (npm run dev)    build server + client; the debug shell runs sidecar/run-server.cjs
 *                                                     with "node" against server/dist and client/dist
 *   node scripts/prepare.cjs         (npm run build)  also produce the sealed engine, bundled into the installer:
 *
 *   engine/apna-billing-engine.exe   Node single-executable application: the Node runtime with the local server bundled
 *                                    and minified into one script (with V8 code cache) and the built client embedded as
 *                                    assets. No JavaScript files, node_modules or client files are installed.
 *   engine/native/better_sqlite3.node  SQLite engine with encryption (SQLite3 Multiple Ciphers, Node-API)
 *   engine/native/apna_core.node       compiled licensing core (native/apna-core, Rust)
 *   engine/license-ca.crt              public certificate of a self-signed license server (optional)
 *   build/engine-manifest.txt          SHA-256 of each file above; compiled into the shell, which refuses to start a
 *                                      modified engine
 *
 * The data key (~/.apna-billing/data.key, or APNA_DATA_KEY_FILE) encrypts every customer's database. It is created on
 * the first build and checked against deploy/data-key.fingerprint on every later one: a build with a different key
 * could not open existing customers' data. Back it up with the update-signing key.
 *
 * Env: LICENSE_SERVER_URL (compiled into the shell by "tauri build"), LICENSE_SERVER_CA (PEM of a self-signed server),
 *      SKIP_BUILD=1 to reuse the server/client builds.
 */
const { execFileSync, execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const tauriDir = path.resolve(__dirname, '..');
const engineDir = path.join(tauriDir, 'engine');
const buildDir = path.join(tauriDir, 'build');
const isDev = process.argv.includes('--dev');
const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit', env: process.env });
const step = (msg) => console.log(`\n==> ${msg}`);
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// ---------------------------------------------------------------- license server address

const licenseServerUrl = process.env.LICENSE_SERVER_URL || '';
if (licenseServerUrl && !licenseServerUrl.startsWith('https://') && !/^http:\/\/(127\.0\.0\.1|localhost)/.test(licenseServerUrl)) {
  throw new Error('LICENSE_SERVER_URL must use https:// (plain http is only allowed for localhost testing)');
}
if (!isDev && !licenseServerUrl) {
  console.warn('\n!  LICENSE_SERVER_URL is not set - this build will talk to http://127.0.0.1:7000 (your own PC only).\n');
}

// ---------------------------------------------------------------- data key

function ensureDataKey() {
  const keyFile = process.env.APNA_DATA_KEY_FILE || path.join(os.homedir(), '.apna-billing', 'data.key');
  const fpFile = path.join(root, 'deploy', 'data-key.fingerprint');
  const fingerprint = (key) => crypto.createHash('sha256').update(`apna-billing data key ${key}`).digest('hex').slice(0, 16);
  const expected = fs.existsSync(fpFile) ? fs.readFileSync(fpFile, 'utf8').trim() : null;
  if (!fs.existsSync(keyFile)) {
    if (expected) {
      throw new Error(`The data key ${keyFile} is missing. Copy it from your backup (fingerprint ${expected}).\n`
        + 'Never build with a new key: installed apps could no longer open their encrypted databases.');
    }
    fs.mkdirSync(path.dirname(keyFile), { recursive: true });
    fs.writeFileSync(keyFile, crypto.randomBytes(32).toString('hex') + '\n', { mode: 0o600 });
    fs.writeFileSync(fpFile, fingerprint(fs.readFileSync(keyFile, 'utf8').trim()) + '\n');
    console.warn(`\n!  Created the data key ${keyFile}. BACK IT UP: every future build needs exactly this key.\n`);
  }
  const key = fs.readFileSync(keyFile, 'utf8').trim();
  if (!/^[0-9a-f]{64}$/.test(key)) throw new Error(`${keyFile} must contain 64 hex characters`);
  if (expected && fingerprint(key) !== expected) {
    throw new Error(`${keyFile} is not the data key this product was built with (fingerprint ${expected}).`);
  }
  if (!expected) fs.writeFileSync(fpFile, fingerprint(key) + '\n');
}
ensureDataKey();

// ---------------------------------------------------------------- server + client

if (!process.env.SKIP_BUILD) {
  step('Building the local server and the client');
  run('npm run build', path.join(root, 'server'));
  run('npm run build', path.join(root, 'client'));
}
// Versions before 1.2 assembled a Node runtime + JavaScript folder here.
fs.rmSync(path.join(tauriDir, 'app'), { recursive: true, force: true });
if (isDev) {
  fs.mkdirSync(engineDir, { recursive: true }); // tauri.conf.json lists it as a resource folder
  console.log('Prepared for development (the debug shell runs sidecar/run-server.cjs with node).');
  process.exit(0);
}

fs.rmSync(engineDir, { recursive: true, force: true });
fs.rmSync(buildDir, { recursive: true, force: true });
fs.mkdirSync(path.join(engineDir, 'native'), { recursive: true });
fs.mkdirSync(buildDir, { recursive: true });

// ---------------------------------------------------------------- native modules

// The compiled modules ship as ordinary .dll files (loaded by file path with process.dlopen), not .node files.
step('Building the licensing core (Rust)');
run('cargo build --release --locked', path.join(root, 'native', 'apna-core'));
fs.copyFileSync(path.join(root, 'native', 'apna-core', 'target', 'release', 'apna_core.dll'), path.join(engineDir, 'native', 'apna-core.dll'));
fs.copyFileSync(
  path.join(root, 'server', 'node_modules', 'better-sqlite3-multiple-ciphers', 'prebuilds', 'win32-x64.node'),
  path.join(engineDir, 'native', 'apna-storage.dll'),
);

// ---------------------------------------------------------------- sealed engine

step('Bundling the local server');
require('esbuild').buildSync({
  entryPoints: [path.join(tauriDir, 'sidecar', 'run-server.cjs')],
  outfile: path.join(buildDir, 'engine.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: `node${process.versions.node.split('.')[0]}`,
  minify: true,
  legalComments: 'none',
  logLevel: 'warning',
  // Only reached when no binding object is passed, which the engine always does (server/src/db/sqlite.ts).
  logOverride: { 'unsupported-require-call': 'silent' },
});

const clientDist = path.join(root, 'client', 'dist');
const assets = {};
const clientFiles = [];
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
  const full = path.join(dir, e.name);
  if (e.isDirectory()) return walk(full);
  const urlPath = '/' + path.relative(clientDist, full).split(path.sep).join('/');
  // The sign-in videos are shipped as plain files next to the engine (see below), not inside its executable
  if (urlPath.startsWith('/login-media/')) return;
  clientFiles.push(urlPath);
  assets[`client${urlPath}`] = full;
});
walk(clientDist);
if (!clientFiles.includes('/index.html')) throw new Error(`${clientDist} has no index.html - build the client first`);
fs.writeFileSync(path.join(buildDir, 'client-manifest.json'), JSON.stringify(clientFiles));
assets['client/manifest.json'] = path.join(buildDir, 'client-manifest.json');

step('Sealing the engine executable');
const seaConfig = path.join(buildDir, 'sea-config.json');
const blob = path.join(buildDir, 'engine.blob');
fs.writeFileSync(seaConfig, JSON.stringify({
  main: path.join(buildDir, 'engine.cjs'),
  output: blob,
  disableExperimentalSEAWarning: true,
  useCodeCache: true,
  // Ignore NODE_OPTIONS and Node command-line flags (--inspect-brk, --require, ...): no code or debugger can be
  // attached before the engine's own checks run.
  execArgvExtension: 'none',
  assets,
}, null, 2));
// The blob (and its code cache) must be made by the same Node binary it is injected into.
execFileSync(process.execPath, ['--experimental-sea-config', seaConfig], { stdio: 'inherit' });

const engineExe = path.join(engineDir, 'apna-billing-engine.exe');
fs.copyFileSync(process.execPath, engineExe);
const version = JSON.parse(fs.readFileSync(path.join(tauriDir, 'package.json'), 'utf8')).version;
const rcedit = path.join(tauriDir, 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe');
execFileSync(rcedit, [engineExe,
  '--set-icon', path.join(tauriDir, 'src-tauri', 'icons', 'icon.ico'),
  '--set-version-string', 'FileDescription', 'Apna Billing Engine',
  '--set-version-string', 'ProductName', 'Apna Billing',
  '--set-version-string', 'CompanyName', 'Apna Billing',
  '--set-version-string', 'LegalCopyright', `Copyright (c) ${new Date().getFullYear()} Apna Billing`,
  '--set-version-string', 'OriginalFilename', 'apna-billing-engine.exe',
  '--set-version-string', 'InternalName', 'apna-billing-engine',
  '--set-file-version', version,
  '--set-product-version', version,
], { stdio: 'inherit' });
execFileSync(process.execPath, [require.resolve('postject/dist/cli.js'), engineExe, 'NODE_SEA_BLOB', blob,
  '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2', '--overwrite'], { stdio: 'inherit' });

// ---------------------------------------------------------------- certificate

// The vendor server's public certificate (self-signed, no domain): the app trusts exactly this one. Never a key.
if (process.env.LICENSE_SERVER_CA) {
  const pem = fs.readFileSync(process.env.LICENSE_SERVER_CA, 'utf8');
  if (!/-----BEGIN CERTIFICATE-----/.test(pem) || /PRIVATE KEY/.test(pem)) throw new Error('LICENSE_SERVER_CA must be a public certificate (PEM), never a private key');
  fs.writeFileSync(path.join(engineDir, 'license-ca.crt'), pem);
}

// ---------------------------------------------------------------- checks + integrity manifest

// The sign-in screen's videos: plain files in engine/login-media, served with range requests by the engine (a video
// cannot start or loop smoothly from the executable's memory). They are pictures, not code, so they stay out of the
// integrity manifest: hashing them would make every start read ~10 MB more, which slow computers feel.
const mediaSrc = path.join(clientDist, 'login-media');
const mediaDest = path.join(engineDir, 'login-media');
if (fs.existsSync(mediaSrc)) {
  const bad = fs.readdirSync(mediaSrc).filter((f) => !/\.(mp4|webp)$/i.test(f));
  if (bad.length) throw new Error(`Only .mp4 and .webp belong in login-media: ${bad.join(', ')}`);
  fs.cpSync(mediaSrc, mediaDest, { recursive: true });
}

const shipped = [];
const collect = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
  const p = path.join(d, e.name);
  if (p === mediaDest) return;
  if (e.isDirectory()) return collect(p);
  shipped.push(p);
});
collect(engineDir);
// Guard: no database, secrets, demo credentials or source may be bundled into the installer.
const forbidden = shipped.filter((p) => /\.(db|db-wal|db-shm|sqlite|pem|env|key|js|cjs|mjs|ts|map)$/i.test(p) || /credentials/i.test(p));
if (forbidden.length) throw new Error(`Refusing to package:\n${forbidden.join('\n')}`);

const manifest = shipped.map((p) => `${sha256(p)}  ${path.relative(engineDir, p).split(path.sep).join('/')}`).join('\n') + '\n';
fs.writeFileSync(path.join(buildDir, 'engine-manifest.txt'), manifest);

step('Smoke test: the sealed engine starts');
smokeTest(engineExe);

console.log(`\nPrepared ${engineDir}`);
for (const p of shipped) console.log(`   ${path.relative(engineDir, p).padEnd(28)} ${(fs.statSync(p).size / 1048576).toFixed(1)} MB`);

/**
 * Start the engine on a throwaway data folder with a throwaway key and hostile environment: it must start, serve the
 * UI and enforce licensing.
 */
function smokeTest(exe) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apna-engine-smoke-'));
  // A sign-in video next to the engine must be served in ranges (how a video starts at once and loops)
  const mediaDir = path.join(path.dirname(exe), 'login-media');
  const video = fs.existsSync(mediaDir) ? fs.readdirSync(mediaDir).find((f) => f.endsWith('.mp4')) || '' : '';
  try {
    const script = `
      const { spawn } = require('child_process');
      const p = spawn(${JSON.stringify(exe)}, [], {
        // NODE_OPTIONS and APNA_LICENSE_ENFORCE must both be ignored by the sealed engine.
        env: { SystemRoot: process.env.SystemRoot, APNA_DATA_DIR: ${JSON.stringify(dataDir)}, APNA_LICENSE_SERVER_URL: 'http://127.0.0.1:9',
          NODE_OPTIONS: '--require ./no-such-file.js', APNA_LICENSE_ENFORCE: '0' },
        stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true,
      });
      p.stdin.write(JSON.stringify({ dbKey: '${crypto.randomBytes(32).toString('hex')}' }) + '\\n');
      let out = '';
      let ok = false;
      const t = setTimeout(() => { console.error('engine did not start'); p.kill(); }, 30000);
      p.stdout.on('data', async (d) => {
        out += d;
        const m = out.match(/APNA_PORT=(\\d+)/);
        if (!m) return;
        out = '';
        clearTimeout(t);
        const base = 'http://127.0.0.1:' + m[1];
        try {
          const license = await (await fetch(base + '/api/v1/license/status')).json();
          ok = (await fetch(base + '/api/health')).ok
            && (await (await fetch(base + '/')).text()).includes('<div id="root">')
            && license.enforced === true && license.mode === 'UNLICENSED';
          const video = ${JSON.stringify(video)};
          if (video) {
            const part = await fetch(base + '/login-media/' + video, { headers: { Range: 'bytes=0-999' } });
            const partOk = part.status === 206 && (await part.arrayBuffer()).byteLength === 1000;
            const missing = (await fetch(base + '/login-media/missing.mp4')).status;
            if (!partOk || missing !== 404) console.error('sign-in videos not served in ranges:', part.status, missing);
            ok = ok && partOk && missing === 404;
          }
        } finally {
          p.stdin.end(); // the engine exits when its shell goes away
        }
      });
      p.on('exit', () => { clearTimeout(t); process.exitCode = ok ? 0 : 1; });
    `;
    execFileSync(process.execPath, ['-e', script], { stdio: 'inherit' });
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
}
