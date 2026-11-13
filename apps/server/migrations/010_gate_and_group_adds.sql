-- Channels and groups a user must join before using the app (checked by the bot).
CREATE TABLE IF NOT EXISTS required_chats (
  id          uuid PRIMARY KEY,
  chat_id     bigint NOT NULL UNIQUE,
  title       text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('channel', 'group')),
  username    text,
  link        text NOT NULL,
  position    int NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Groups and channels the bot was added to (so the panel can offer them without typing ids).
CREATE TABLE IF NOT EXISTS bot_chats (
  chat_id     bigint PRIMARY KEY,
  title       text,
  kind        text,
  username    text,
  bot_status  text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- The new invite system: people a user added to the Wall group. Each Telegram account counts once,
-- for whoever added it first, so leaving and re-adding the same friend earns nothing.
CREATE TABLE IF NOT EXISTS group_adds (
  added_tg_id  bigint PRIMARY KEY,
  adder_tg_id  bigint NOT NULL,
  chat_id      bigint NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS group_adds_adder ON group_adds (adder_tg_id);

-- Random chats used so far (only counted for accounts that have a limit).
ALTER TABLE users ADD COLUMN IF NOT EXISTS rc_used int NOT NULL DEFAULT 0;

-- One request a day on the Wall, for everyone; the old invite-link rewards are replaced.
UPDATE app_settings SET value = jsonb_set(jsonb_set(value, '{wall,repostCooldownHours}', '24'), '{wall,freeDailyPosts}', '1')
WHERE key = 'app' AND value ? 'wall';
UPDATE app_settings SET value = value - 'referral' WHERE key = 'app';
UPDATE app_settings SET value = value #- '{randomChat,freeDailySessions}' WHERE key = 'app';
