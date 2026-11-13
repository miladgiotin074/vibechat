import postgres from 'postgres';
import { env } from '../config.js';

/**
 * One pool per process. postgres.js prepares statements automatically and pipelines queries,
 * which matters on the hot paths (discovery, swipes, messages). Behind PgBouncer in transaction
 * mode server-side prepared statements must be off (DATABASE_PGBOUNCER=true).
 * int8 columns (message, notification and Telegram ids) come back as strings, so they never lose precision in JSON.
 */
export const sql = postgres(env.DATABASE_URL, {
  max: env.DATABASE_POOL_MAX,
  idle_timeout: 30,
  connect_timeout: 10,
  prepare: !env.DATABASE_PGBOUNCER,
  transform: { undefined: null },
  onnotice: () => {},
});

export type Sql = typeof sql;
export type Tx = postgres.TransactionSql;

export async function closeDb() {
  await sql.end({ timeout: 5 });
}

/**
 * Waits until Postgres answers (it can still be starting: on its very first boot it creates the
 * database, which takes a few seconds). Gives up after `seconds`, with the last error.
 */
export async function waitForDatabase(log: (m: string) => void, seconds = 120) {
  const until = Date.now() + seconds * 1000;
  for (let attempt = 1; ; attempt++) {
    try {
      await sql`SELECT 1`;
      if (attempt > 1) log('database is ready');
      return;
    } catch (e) {
      if (Date.now() > until) throw e;
      if (attempt === 1 || attempt % 5 === 0) log(`waiting for the database (${(e as Error).message})`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}
