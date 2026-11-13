/**
 * npm run admin:create -- <username> <password> [superadmin|moderator|support]
 * Creates an admin, or resets the password and role of an existing one.
 */
import { closeDb, sql } from '../lib/db.js';
import { uuidv7 } from '../lib/ids.js';
import { hashPassword } from '../lib/tokens.js';

const [username, password, role = 'superadmin'] = process.argv.slice(2);
if (!username || !password || !['superadmin', 'moderator', 'support'].includes(role)) {
  console.error('usage: npm run admin:create -- <username> <password> [superadmin|moderator|support]');
  process.exit(1);
}
if (password.length < 10) {
  console.error('password must be at least 10 characters');
  process.exit(1);
}
const name = username.trim().toLowerCase();
await sql`
  INSERT INTO admins (id, username, password_hash, role)
  VALUES (${uuidv7()}, ${name}, ${await hashPassword(password)}, ${role})
  ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, is_active = true`;
console.log(`admin "${name}" (${role}) is ready`);
await closeDb();
