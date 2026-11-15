/**
 * Assemble desktop/app/ from fresh builds:
 *   app/server  ← server/dist  (tsc output)
 *   app/client  ← client/dist  (vite output)
 *   app/config.json ← build-time settings (license server URL)
 *
 * Usage: LICENSE_SERVER_URL=https://license.yourdomain.com node scripts/prepare.cjs
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const appDir = path.resolve(__dirname, '..', 'app');
const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit', env: process.env });

const licenseServerUrl = process.env.LICENSE_SERVER_URL || '';
if (!licenseServerUrl) {
  console.warn('\n⚠  LICENSE_SERVER_URL is not set — the build will point at a placeholder and activation will fail.\n');
} else if (!licenseServerUrl.startsWith('https://') && !/^http:\/\/(127\.0\.0\.1|localhost)/.test(licenseServerUrl)) {
  throw new Error('LICENSE_SERVER_URL must use https:// (plain http is only allowed for localhost testing)');
}

if (!process.env.SKIP_BUILD) {
  run('npm run build', path.join(root, 'server'));
  run('npm run build', path.join(root, 'client'));
}

fs.rmSync(appDir, { recursive: true, force: true });
fs.mkdirSync(appDir, { recursive: true });
fs.cpSync(path.join(root, 'server', 'dist'), path.join(appDir, 'server'), { recursive: true });
fs.cpSync(path.join(root, 'client', 'dist'), path.join(appDir, 'client'), { recursive: true });
fs.writeFileSync(path.join(appDir, 'config.json'), JSON.stringify({ licenseServerUrl: licenseServerUrl || 'https://license.apnabilling.example' }, null, 2));

// Guard: no database, secrets or demo credentials may be bundled into the installer.
const forbidden = [];
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
  const p = path.join(d, e.name);
  if (e.isDirectory()) return walk(p);
  if (/\.(db|db-wal|db-shm|sqlite|pem|env)$/i.test(e.name) || /credentials/i.test(e.name)) forbidden.push(p);
});
walk(appDir);
if (forbidden.length) throw new Error(`Refusing to package sensitive files:\n${forbidden.join('\n')}`);

console.log(`Prepared ${appDir} (license server: ${licenseServerUrl || 'placeholder'})`);
