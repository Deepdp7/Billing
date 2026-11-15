import { encryptLegacyBackups, runScheduledBackupIfDue } from './services/backupService.js';
import { recoverIfVendorRemovedShop, syncLicense, syncUsage } from './licensing/licenseClient.js';
import { config } from './config/index.js';
import { startRealtime, stopRealtime } from './licensing/realtime.js';
import { startConnectivityMonitor, stopConnectivityMonitor } from './licensing/connectivity.js';

const timers: NodeJS.Timeout[] = [];
let running = false;

async function safe(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (err: any) {
    console.warn(`[Jobs] ${name} failed: ${err?.message || err}`);
  }
}

/** Non-critical background work. Nothing here may block or fail a billing request. */
export function startBackgroundJobs(): void {
  if (running || process.env.NODE_ENV === 'test') return;
  running = true;

  // Scheduled local backups: check hourly, back up when the configured interval has elapsed.
  timers.push(setTimeout(() => safe('auto-backup', runScheduledBackupIfDue), 60_000));
  timers.push(setInterval(() => safe('auto-backup', runScheduledBackupIfDue), 60 * 60 * 1000));

  // Backups made before encrypted storage (version 1.2) are encrypted once, in the background.
  timers.push(setTimeout(() => safe('encrypt-backups', async () => encryptLegacyBackups()), 20_000));

  // License revalidation + usage upload. Runs shortly after start and then periodically.
  const licenseTick = async () => {
    await safe('license-sync', () => syncLicense('scheduled'));
    await safe('usage-sync', syncUsage);
  };
  timers.push(setTimeout(licenseTick, 5_000));
  timers.push(setInterval(licenseTick, config.licensing.syncIntervalMs));

  // A customer deleted after this computer was signed out leaves the shop file behind. Confirm and erase it.
  timers.push(setTimeout(() => safe('removed-customer', recoverIfVendorRemovedShop), 2_000));

  // Live link: Admin Panel changes apply within seconds while online (the scheduled sync stays as the fallback).
  startRealtime();

  // The app needs the internet: the UI locks while this reports offline (licensed builds only).
  if (config.licensing.enforce) startConnectivityMonitor();
}

export function stopBackgroundJobs(): void {
  stopRealtime();
  stopConnectivityMonitor();
  for (const t of timers.splice(0)) {
    clearTimeout(t);
    clearInterval(t);
  }
  running = false;
}
