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
