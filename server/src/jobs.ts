import { encryptLegacyBackups, runScheduledBackupIfDue } from './services/backupService.js';
import { offerUpdateWithoutLicence, recoverIfVendorRemovedShop, registerPendingCustomer, syncLicense, syncUsage } from './licensing/licenseClient.js';
import { config } from './config/index.js';
import { realtimeStatus, startRealtime, stopRealtime } from './licensing/realtime.js';
import { startConnectivityMonitor, stopConnectivityMonitor } from './licensing/connectivity.js';
import { activeShopId, onActiveShopChanged, runInShop } from './db/shops.js';
import { msSinceSync, requestSync, syncEnabled } from './sync/syncEngine.js';

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
  // Everything started here (timers, the live link, work after an await) stays on this business's database
  runInShop(activeShopId(), startForActiveShop);
}

// Another business signed in: licence checks, backups and the live link move to it
onActiveShopChanged(() => {
  if (!running) return;
  stopBackgroundJobs();
  startBackgroundJobs();
});

function startForActiveShop(): void {
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

  // A shop set up while offline is sent to the vendor now, so it shows up in the Admin Panel before it has a licence
  timers.push(setTimeout(() => safe('register-customer', registerPendingCustomer), 3_000));

  // A computer without a licence hears of new versions too (licensed ones get them with the licence check)
  timers.push(setTimeout(() => safe('update-unlicensed', offerUpdateWithoutLicence), 4_000));
  timers.push(setInterval(() => safe('update-unlicensed', offerUpdateWithoutLicence), config.licensing.syncIntervalMs));

  // A customer deleted after this computer was signed out leaves the shop file behind. Confirm and erase it.
  timers.push(setTimeout(() => safe('removed-customer', recoverIfVendorRemovedShop), 2_000));

  // Shared data with the account's other computers: at once on start; changes made here and pushes from the server
  // sync immediately. Without the live link (dropped, reconnecting, blocked by the network) it checks every 3 s,
  // with it every 15 s in case a push was missed.
  if (syncEnabled()) {
    const shop = activeShopId();
    timers.push(setTimeout(() => requestSync(shop, 0), 1_500));
    timers.push(setInterval(() => {
      if (!realtimeStatus().connected || msSinceSync(shop) >= 15_000) requestSync(shop, 0);
    }, 3_000));
  }

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
