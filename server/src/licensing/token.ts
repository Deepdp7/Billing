import crypto from 'crypto';

/** Signed entitlement payload issued by the license server. */
export interface LicensePayload {
  v: 1;
  iid: string; // installation id
  lid: string; // license id
  cid: string; // customer id
  customerName: string;
  licenseKeyHint: string; // last characters only
  type: 'TRIAL' | 'PAID';
  plan: { code: string; name: string };
  status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | 'EXPIRED';
  installationStatus: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
  licenseExpiresAt: string | null; // null = lifetime
  features: Record<string, { enabled: boolean; expiresAt?: string | null }>;
  maxDevices: number;
  graceDays: number;
  iat: string; // server time of issue
  exp: string; // token must be refreshed online before this (offline grace limit)
}

export class TokenError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

const b64url = {
  decode: (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'),
};

/**
 * Token format: base64url(JSON payload) + "." + base64url(Ed25519 signature over the first part).
 * A fixed algorithm avoids JWT "alg" confusion; a token edited in SQLite fails verification.
 */
export function verifyLicenseToken(token: string, publicKeyPem: string): LicensePayload {
  if (typeof token !== 'string' || token.split('.').length !== 2) throw new TokenError('TOKEN_MALFORMED', 'License token is malformed');
  const [body, sig] = token.split('.');
  let ok = false;
  try {
    ok = crypto.verify(null, Buffer.from(body, 'utf8'), crypto.createPublicKey(publicKeyPem), b64url.decode(sig));
  } catch {
    ok = false;
  }
  if (!ok) throw new TokenError('TOKEN_SIGNATURE_INVALID', 'License signature is invalid');
  let payload: LicensePayload;
  try {
    payload = JSON.parse(b64url.decode(body).toString('utf8'));
  } catch {
    throw new TokenError('TOKEN_MALFORMED', 'License payload is unreadable');
  }
  if (payload.v !== 1 || !payload.iid || !payload.iat || !payload.exp) throw new TokenError('TOKEN_MALFORMED', 'License payload is incomplete');
  return payload;
}
