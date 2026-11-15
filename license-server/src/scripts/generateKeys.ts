import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * Generate a production Ed25519 signing keypair.
 *  - Private key → license-server/keys/signing-private.pem (keep secret; back it up offline; never commit).
 *  - Public key  → embedded into the desktop app (server/src/licensing/publicKey.ts).
 * Rotating this key invalidates every token in the field until each install reconnects with a new build.
 */
const keysDir = path.resolve(process.cwd(), 'keys');
const privPath = path.join(keysDir, 'signing-private.pem');
const force = process.argv.includes('--force');

if (fs.existsSync(privPath) && !force) {
  console.error(`${privPath} already exists. Pass --force to replace it (all deployed installs must then be updated).`);
  process.exit(1);
}

fs.mkdirSync(keysDir, { recursive: true });
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const pub = publicKey.export({ type: 'spki', format: 'pem' }) as string;
fs.writeFileSync(privPath, privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, { mode: 0o600 });
fs.writeFileSync(path.join(keysDir, 'signing-public.pem'), pub);

const desktopKeyFile = path.resolve(process.cwd(), '..', 'server', 'src', 'licensing', 'publicKey.ts');
if (fs.existsSync(desktopKeyFile)) {
  const src = fs.readFileSync(desktopKeyFile, 'utf8');
  fs.writeFileSync(desktopKeyFile, src.replace(/`-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----\n?`/, `\`${pub}\``));
  console.log(`Embedded public key into ${desktopKeyFile}`);
}
console.log(`Private key written to ${privPath}`);
console.log(pub);
