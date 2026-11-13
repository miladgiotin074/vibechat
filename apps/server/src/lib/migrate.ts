import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sql } from './db.js';

/** backend/migrations, from both src/lib (tsx) and dist/src/lib (compiled). */
function migrationsDir(): string {
  const up = import.meta.url.includes('/dist/') ? '../../../migrations/' : '../../migrations/';
  return fileURLToPath(new URL(up, import.meta.url));
}

/**
 * Applies migrations/NNN_*.sql in order, each in its own transaction. An advisory lock makes it
 * safe to run from several instances at once (the others wait, then find nothing to do).
 */
export async function runMigrations(log: (msg: string) => void = console.log): Promise<number> {
  const dir = migrationsDir();
  const files = (await readdir(dir)).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  let applied = 0;
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(7238001)`;
    await tx`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
    const done = new Set((await tx<{ name: string }[]>`SELECT name FROM schema_migrations`).map((r) => r.name));
    for (const file of files) {
      if (done.has(file)) continue;
      const text = await readFile(dir + file, 'utf8');
      log(`applying ${file}`);
      await tx.unsafe(text);
      await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
      applied++;
    }
  });
  return applied;
}
