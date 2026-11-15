import { loadNativeModule } from '../lib/native.js';

/** Interface of the compiled licensing core (native/apna-core). */
export interface NativeLicenseCore {
  /** Payload JSON; throws "CODE: message" when the token is malformed or its signature is invalid. */
  verifyLicenseToken(token: string): string;
  evaluateLicense(input: {
    token?: string;
    installationId?: string;
    maxSeenTime?: string;
    now: number;
    featureKeys: string[];
  }): {
    mode: string;
    canWrite: boolean;
    payloadJson?: string | null;
    features: Record<string, boolean>;
    featureExpiry: Record<string, string | null>;
    storeMaxSeenTime?: string | null;
  };
  coreInfo(): { version: string; keyId: string };
}

/**
 * The packaged engine verifies and evaluates licenses in compiled code with the public key built into it. Running
 * from source (development, tests) there is no native core and the TypeScript implementation is used instead.
 */
export function nativeLicenseCore(): NativeLicenseCore | null {
  return loadNativeModule<NativeLicenseCore>('apna-core.dll');
}
