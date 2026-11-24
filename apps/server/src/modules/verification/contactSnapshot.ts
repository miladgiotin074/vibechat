import type { TelegramClient } from 'teleproto';
import { sql } from '../../lib/db.js';
import { loadMutualUsers, type TelegramContact } from './telegram.js';

/** The address book of one user as it was read from Telegram: at verify time, or on a manual refresh. */
export type ContactSnapshot = { contacts: TelegramContact[]; capturedAt: string };

export async function saveContactSnapshot(userId: string, contacts: TelegramContact[]) {
  const mutual = contacts.filter((c) => c.mutual).length;
  await sql`
    INSERT INTO tg_contact_snapshots (user_id, contacts, count, mutual_count, captured_at)
    VALUES (${userId}, ${sql.json(contacts as never)}, ${contacts.length}, ${mutual}, now())
    ON CONFLICT (user_id) DO UPDATE SET
      contacts = excluded.contacts,
      count = excluded.count,
      mutual_count = excluded.mutual_count,
      captured_at = excluded.captured_at`;
}

export async function readContactSnapshot(userId: string): Promise<ContactSnapshot | null> {
  const [row] = await sql<{ contacts: TelegramContact[]; captured_at: Date }[]>`
    SELECT contacts, captured_at FROM tg_contact_snapshots WHERE user_id = ${userId}`;
  if (!row) return null;
  return { contacts: row.contacts, capturedAt: row.captured_at.toISOString() };
}

/** Reads the address book off an already open client — no second login, no extra code. */
export async function captureContactSnapshot(userId: string, client: TelegramClient) {
  const book = await loadMutualUsers(client);
  await saveContactSnapshot(userId, book.all);
}
