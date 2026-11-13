-- Vibe Chat core schema (PostgreSQL 16+).
--
-- Design rules:
--  * Ids are UUIDv7 (time-ordered) so inserts land at the right edge of B-tree indexes.
--  * The two append-heavy tables (swipes, messages) are hash-partitioned and carry no foreign keys
--    on purpose: no extra lookups per insert, small per-partition indexes, parallel vacuum.
--  * Discovery reads only through partial indexes that already exclude everyone who can't be shown.
--  * Hot counters (likes received, DAU, daily stats) live in Redis and are folded in by the worker,
--    so a swipe never locks a users row.

CREATE EXTENSION IF NOT EXISTS cube;
CREATE EXTENSION IF NOT EXISTS earthdistance;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------- users
CREATE TABLE users (
  id                 uuid PRIMARY KEY,
  -- Telegram identity. NULL after the account is deleted, so the same Telegram user can sign up again.
  telegram_id        bigint UNIQUE,
  tg_username        text,
  tg_first_name      text,
  tg_last_name       text,
  tg_language        text,
  tg_premium         boolean NOT NULL DEFAULT false,
  -- The bot may message this user (they started the bot or allowed it from the Mini App).
  can_dm             boolean NOT NULL DEFAULT false,
  -- They blocked the bot: stop sending until they come back.
  bot_blocked        boolean NOT NULL DEFAULT false,
  -- Personal invite code (t.me/<bot>/<app>?startapp=r_<code>).
  ref_code           text NOT NULL UNIQUE,

  status             text NOT NULL DEFAULT 'onboarding'
                     CHECK (status IN ('onboarding', 'active', 'suspended', 'banned', 'deleted')),
  name               text,
  gender             text CHECK (gender IN ('male', 'female')),
  birthdate          date,
  interested_in      text CHECK (interested_in IN ('male', 'female', 'everyone')),
  goal               text,
  bio                text,
  job                text,
  education          text,
  height_cm          smallint CHECK (height_cm BETWEEN 120 AND 230),
  smoking            text,
  marital_status     text,
  interests          text[] NOT NULL DEFAULT '{}',
  province_id        smallint,
  city_id            integer,
  lat                double precision,
  lng                double precision,
  location_at        timestamptz,
  is_verified        boolean NOT NULL DEFAULT false,
  premium_until      timestamptz,
  boost_until        timestamptz,
  -- Super likes earned from invites/rewards, spent after the daily quota.
  bonus_superlikes   integer NOT NULL DEFAULT 0 CHECK (bonus_superlikes >= 0),
  show_telegram      boolean NOT NULL DEFAULT false,
  hide_age           boolean NOT NULL DEFAULT false,
  hide_distance      boolean NOT NULL DEFAULT false,
  incognito          boolean NOT NULL DEFAULT false,
  discoverable       boolean NOT NULL DEFAULT true,
  shadow_banned      boolean NOT NULL DEFAULT false,
  pref_min_age       smallint NOT NULL DEFAULT 18,
  pref_max_age       smallint NOT NULL DEFAULT 45,
  pref_scope         text NOT NULL DEFAULT 'country' CHECK (pref_scope IN ('city', 'province', 'country', 'nearby')),
  pref_max_km        smallint NOT NULL DEFAULT 50,
  pref_verified_only boolean NOT NULL DEFAULT false,
  notify_matches     boolean NOT NULL DEFAULT true,
  notify_messages    boolean NOT NULL DEFAULT true,
  notify_likes       boolean NOT NULL DEFAULT true,
  photo_count        smallint NOT NULL DEFAULT 0,
  likes_received     integer NOT NULL DEFAULT 0,
  passes_received    integer NOT NULL DEFAULT 0,
  score              real NOT NULL DEFAULT 0,
  ban_reason         text,
  -- When onboarding finished. New profiles get extra visibility for a while (first impressions matter).
  activated_at       timestamptz,
  last_active_at     timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);

-- Discovery walks these newest-active first; the predicate keeps only people who can be shown.
CREATE INDEX users_discover_province_idx ON users (gender, province_id, last_active_at DESC)
  WHERE status = 'active' AND discoverable AND NOT shadow_banned AND photo_count > 0;
CREATE INDEX users_discover_city_idx ON users (gender, city_id, last_active_at DESC)
  WHERE status = 'active' AND discoverable AND NOT shadow_banned AND photo_count > 0;
CREATE INDEX users_discover_country_idx ON users (gender, last_active_at DESC)
  WHERE status = 'active' AND discoverable AND NOT shadow_banned AND photo_count > 0;
CREATE INDEX users_geo_idx ON users USING gist (ll_to_earth(lat, lng))
  WHERE lat IS NOT NULL AND lng IS NOT NULL AND status = 'active' AND discoverable AND NOT shadow_banned AND photo_count > 0;
-- admin panel search
CREATE INDEX users_name_trgm_idx ON users USING gin (name gin_trgm_ops);
CREATE INDEX users_tg_username_idx ON users (lower(tg_username) text_pattern_ops);
CREATE INDEX users_created_idx ON users (created_at DESC);
CREATE INDEX users_status_idx ON users (status, created_at DESC);
-- re-engagement jobs: who can be messaged and has been away for a while
CREATE INDEX users_dm_idle_idx ON users (last_active_at) WHERE status = 'active' AND can_dm AND NOT bot_blocked;

-- ---------------------------------------------------------------- referrals
-- One row per invited user. 'qualified' once the invitee finished their profile (that's when the
-- inviter is rewarded, so fake empty accounts earn nothing).
CREATE TABLE referrals (
  invitee_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  inviter_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'joined' CHECK (status IN ('joined', 'qualified')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  qualified_at  timestamptz
);
CREATE INDEX referrals_inviter_idx ON referrals (inviter_id, created_at DESC);

-- ---------------------------------------------------------------- auth sessions
CREATE TABLE auth_sessions (
  id                 uuid PRIMARY KEY,
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_hash       text NOT NULL UNIQUE,
  prev_refresh_hash  text,
  platform           text,
  app_version        text,
  ip                 inet,
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_used_at       timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz
);
CREATE INDEX auth_sessions_user_idx ON auth_sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX auth_sessions_prev_idx ON auth_sessions (prev_refresh_hash) WHERE prev_refresh_hash IS NOT NULL;
CREATE INDEX auth_sessions_expires_idx ON auth_sessions (expires_at);

-- ---------------------------------------------------------------- photos
CREATE TABLE photos (
  id             uuid PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position       smallint NOT NULL DEFAULT 0,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  source         text NOT NULL DEFAULT 'upload' CHECK (source IN ('upload', 'telegram')),
  storage_key    text NOT NULL,
  -- blurred preview lives under an unrelated random key, so it cannot be traced back to the full photo
  blur_key       text NOT NULL,
  width          integer NOT NULL,
  height         integer NOT NULL,
  color          text,
  reject_reason  text,
  reviewed_by    uuid,
  reviewed_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX photos_user_idx ON photos (user_id, position);
CREATE INDEX photos_pending_idx ON photos (created_at) WHERE status = 'pending';

-- ---------------------------------------------------------------- swipes (partitioned)
-- action: 0 = pass, 1 = like, 2 = super like
CREATE TABLE swipes (
  swiper_id   uuid NOT NULL,
  target_id   uuid NOT NULL,
  action      smallint NOT NULL CHECK (action IN (0, 1, 2)),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (swiper_id, target_id)
) PARTITION BY HASH (swiper_id);

DO $$
BEGIN
  FOR i IN 0..31 LOOP
    EXECUTE format('CREATE TABLE swipes_p%s PARTITION OF swipes FOR VALUES WITH (MODULUS 32, REMAINDER %s)', i, i);
  END LOOP;
END $$;

-- "who liked me"
CREATE INDEX swipes_target_likes_idx ON swipes (target_id, created_at DESC) WHERE action > 0;

-- ---------------------------------------------------------------- matches
CREATE TABLE matches (
  id                    uuid PRIMARY KEY,
  user_a                uuid NOT NULL REFERENCES users(id),
  user_b                uuid NOT NULL REFERENCES users(id),
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'unmatched')),
  source                text NOT NULL DEFAULT 'swipe' CHECK (source IN ('swipe', 'random')),
  unmatched_by          uuid,
  unmatched_at          timestamptz,
  last_message_id       bigint,
  last_message_at       timestamptz,
  last_message_preview  text,
  last_message_kind     text,
  last_sender_id        uuid,
  message_count         integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (user_a < user_b),
  UNIQUE (user_a, user_b)
);
CREATE INDEX matches_created_idx ON matches (created_at DESC);

-- One row per side, so "my conversations" is a single index range scan.
CREATE TABLE match_members (
  match_id       uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL,
  peer_id        uuid NOT NULL,
  unread_count   integer NOT NULL DEFAULT 0,
  last_read_id   bigint NOT NULL DEFAULT 0,
  muted          boolean NOT NULL DEFAULT false,
  hidden         boolean NOT NULL DEFAULT false,
  sort_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, match_id)
);
CREATE UNIQUE INDEX match_members_peer_idx ON match_members (user_id, peer_id);
CREATE INDEX match_members_list_idx ON match_members (user_id, sort_at DESC) WHERE NOT hidden;

-- ---------------------------------------------------------------- messages (partitioned)
CREATE SEQUENCE messages_id_seq;
CREATE TABLE messages (
  match_id    uuid NOT NULL,
  id          bigint NOT NULL DEFAULT nextval('messages_id_seq'),
  sender_id   uuid NOT NULL,
  kind        text NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'image', 'system')),
  body        text,
  media       jsonb,
  reply_to    bigint,
  client_id   text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  edited_at   timestamptz,
  deleted_at  timestamptz,
  PRIMARY KEY (match_id, id)
) PARTITION BY HASH (match_id);

DO $$
BEGIN
  FOR i IN 0..31 LOOP
    EXECUTE format('CREATE TABLE messages_p%s PARTITION OF messages FOR VALUES WITH (MODULUS 32, REMAINDER %s)', i, i);
  END LOOP;
END $$;

-- idempotent sends (the app retries with the same client_id)
CREATE UNIQUE INDEX messages_client_idx ON messages (match_id, sender_id, client_id) WHERE client_id IS NOT NULL;

-- ---------------------------------------------------------------- safety
CREATE TABLE blocks (
  blocker_id  uuid NOT NULL,
  blocked_id  uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id)
);
CREATE INDEX blocks_blocked_idx ON blocks (blocked_id);

CREATE TABLE reports (
  id               uuid PRIMARY KEY,
  reporter_id      uuid NOT NULL REFERENCES users(id),
  reported_id      uuid NOT NULL REFERENCES users(id),
  reason           text NOT NULL,
  details          text,
  match_id         uuid,
  context          jsonb,
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  action           text,
  resolution_note  text,
  resolved_by      uuid,
  resolved_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reports_status_idx ON reports (status, created_at DESC);
CREATE INDEX reports_reported_idx ON reports (reported_id, created_at DESC);
CREATE UNIQUE INDEX reports_open_once_idx ON reports (reporter_id, reported_id) WHERE status = 'open';

CREATE TABLE verifications (
  id             uuid PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  selfie_key     text NOT NULL,
  pose           text NOT NULL,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reject_reason  text,
  reviewed_by    uuid,
  reviewed_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verifications_pending_idx ON verifications (created_at) WHERE status = 'pending';
CREATE INDEX verifications_user_idx ON verifications (user_id, created_at DESC);

-- ---------------------------------------------------------------- notifications
CREATE TABLE notifications (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL,
  type        text NOT NULL,
  title       text NOT NULL,
  body        text,
  data        jsonb,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, id DESC);
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;
CREATE INDEX notifications_created_idx ON notifications (created_at);

CREATE TABLE announcements (
  id          bigserial PRIMARY KEY,
  title       text NOT NULL,
  body        text NOT NULL,
  segment     jsonb NOT NULL DEFAULT '{}',
  -- also delivered as a Telegram message by the bot (in the background, rate limited)
  via_bot     boolean NOT NULL DEFAULT false,
  bot_sent    integer NOT NULL DEFAULT 0,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz
);

-- ---------------------------------------------------------------- premium & payments
CREATE TABLE plans (
  id             uuid PRIMARY KEY,
  title          text NOT NULL,
  description    text,
  duration_days  integer NOT NULL CHECK (duration_days > 0),
  price_toman    integer NOT NULL CHECK (price_toman > 0),
  -- crossed-out price shown next to the real one (marketing), optional
  old_price_toman integer CHECK (old_price_toman IS NULL OR old_price_toman > 0),
  badge          text,
  is_active      boolean NOT NULL DEFAULT true,
  sort           integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Online payments through the Tetra98 gateway. The gateway token is unique, and settlement is an
-- UPDATE ... WHERE status = 'pending', so verify + webhook arriving together still credit once.
CREATE TABLE payments (
  id            uuid PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users(id),
  plan_id       uuid NOT NULL REFERENCES plans(id),
  amount_toman  integer NOT NULL,
  gateway       text NOT NULL DEFAULT 'tetra',
  token         text UNIQUE,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'canceled', 'expired')),
  method        text,
  gateway_data  jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  paid_at       timestamptz
);
CREATE INDEX payments_user_idx ON payments (user_id, created_at DESC);
CREATE INDEX payments_status_idx ON payments (status, created_at DESC);
CREATE INDEX payments_paid_idx ON payments (paid_at) WHERE status = 'paid';

-- ---------------------------------------------------------------- admin
CREATE TABLE admins (
  id             uuid PRIMARY KEY,
  username       text NOT NULL UNIQUE,
  password_hash  text NOT NULL,
  display_name   text,
  role           text NOT NULL DEFAULT 'moderator' CHECK (role IN ('superadmin', 'moderator', 'support')),
  is_active      boolean NOT NULL DEFAULT true,
  last_login_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id           bigserial PRIMARY KEY,
  admin_id     uuid,
  action       text NOT NULL,
  target_type  text,
  target_id    text,
  meta         jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);
CREATE INDEX audit_logs_target_idx ON audit_logs (target_type, target_id);

CREATE TABLE app_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid
);

-- Filled by the worker from Redis counters; feeds the dashboard charts.
CREATE TABLE daily_stats (
  day           date PRIMARY KEY,
  signups       integer NOT NULL DEFAULT 0,
  activations   integer NOT NULL DEFAULT 0,
  referrals     integer NOT NULL DEFAULT 0,
  active_users  integer NOT NULL DEFAULT 0,
  swipes        integer NOT NULL DEFAULT 0,
  likes         integer NOT NULL DEFAULT 0,
  matches       integer NOT NULL DEFAULT 0,
  messages      integer NOT NULL DEFAULT 0,
  revenue_toman bigint NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
