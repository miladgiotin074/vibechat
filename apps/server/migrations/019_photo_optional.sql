-- A profile picture is no longer required.
--
-- Someone whose Telegram account has no profile photo (or does not share it with bots) is never
-- asked for one: the app draws their name as their picture. So discovery has to show them too —
-- the index it reads no longer demands a photo. Having photos still lifts a profile in the
-- ranking (see `queryPeople`), it just isn't the price of admission any more.

DROP INDEX IF EXISTS users_discover_idx;
CREATE INDEX IF NOT EXISTS users_discover_idx ON users (gender, last_active_at DESC)
  WHERE status = 'active' AND discoverable AND NOT shadow_banned;
