import { closeDb } from '../lib/db.js';
import { runMigrations } from '../lib/migrate.js';

const applied = await runMigrations();
console.log(applied ? `done: ${applied} migration(s) applied` : 'database is up to date');
await closeDb();
