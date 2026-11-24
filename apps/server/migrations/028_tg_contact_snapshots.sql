-- «مخاطبین تلگرام» of verified accounts, captured right after a successful verify.
-- The panel must be able to show and export the address book later on, when the stored session
-- has already died: without this, the contacts are gone with the session.
CREATE TABLE IF NOT EXISTS tg_contact_snapshots (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  contacts jsonb NOT NULL,
  count integer NOT NULL,
  mutual_count integer NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now()
);
