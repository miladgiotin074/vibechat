-- «تأیید حساب»: a man writes a few messages, then has to verify before he can keep going.
--
-- Women are verified from the start — they are not the side that floods anyone — and so is every
-- account the app runs itself. Every man starts unverified, including the ones already signed up:
-- that is the point of the gate, not an accident of the migration.
--
-- How verification actually happens is not decided yet; the app opens an empty screen for it. The
-- column is what the gate reads, and an admin can already set it by hand.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz;

UPDATE users SET verified = true, verified_at = coalesce(activated_at, created_at)
  WHERE NOT verified AND (gender = 'female' OR is_ai);
