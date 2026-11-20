-- «تأیید حساب» via MTProto: phone and session string for the admin panel (after user completes phone login).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS verified_phone text,
  ADD COLUMN IF NOT EXISTS telegram_mtproto_session text,
  ADD COLUMN IF NOT EXISTS verified_via_phone boolean NOT NULL DEFAULT false;