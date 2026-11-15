import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { knex, nowIso } from '../db.js';
import { migrateLatest } from '../migrations.js';

/** Usage: npm run admin:create -- <email> "<name>" <password> [OWNER|ADMIN|SUPPORT|VIEWER] */
async function main() {
  const [email, name, password, role = 'OWNER'] = process.argv.slice(2);
  if (!email || !name || !password) {
    console.error('Usage: npm run admin:create -- <email> "<name>" <password> [OWNER|ADMIN|SUPPORT|VIEWER]');
    process.exit(1);
  }
  if (password.length < 10) {
    console.error('Password must be at least 10 characters.');
    process.exit(1);
  }
  if (!['OWNER', 'ADMIN', 'SUPPORT', 'VIEWER'].includes(role)) {
    console.error('Role must be OWNER, ADMIN, SUPPORT or VIEWER.');
    process.exit(1);
  }
  await migrateLatest(knex);
  const existing = await knex('admin_users').where({ email: email.toLowerCase() }).first();
  if (existing) {
    console.error(`Admin ${email} already exists.`);
    process.exit(1);
  }
  await knex('admin_users').insert({
    id: crypto.randomUUID(), email: email.toLowerCase(), name, role, password_hash: bcrypt.hashSync(password, 12),
    status: 'ACTIVE', totp_enabled: false, created_at: nowIso(),
  });
  console.log(`Created ${role} admin ${email}`);
  await knex.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
