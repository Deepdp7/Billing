import { EventEmitter } from 'events';
import { currentShopId } from '../db/shops.js';

/**
 * In-process notifications about the local license state, consumed by the UI's live stream (GET /license/events).
 * 'changed' fires after every sync, activation or deactivation; listeners re-read /license/status themselves.
 */
export const licenseEvents = new EventEmitter();
licenseEvents.setMaxListeners(200);

export function emitLicenseChanged(source: string, extra?: Record<string, unknown>): void {
  licenseEvents.emit('changed', { source, at: new Date().toISOString(), shop: currentShopId(), ...extra });
}
