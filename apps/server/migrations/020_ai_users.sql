-- Profiles the app itself runs, answered by a language model (Ollama's hosted API).
--
-- An AI profile is an ordinary row in `users`: it has a name, photos, a gender, an age and a bio,
-- it shows up in discovery and it holds conversations like anyone else. What makes it one is
-- `is_ai`, and the row in `ai_bots` that says who it is pretending to be. It has no telegram_id,
-- so nobody can log into it, and the bot never sends it a Telegram message.

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_ai boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS ai_bots (
  user_id       uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- Who this profile is, in their own words: it becomes the model's system prompt.
  persona       text NOT NULL DEFAULT '',
  -- Which Ollama model answers for them; empty means «whatever the settings say».
  model         text NOT NULL DEFAULT '',
  -- Off: the profile stays as it is but stops replying (and leaves discovery).
  enabled       boolean NOT NULL DEFAULT true,
  replies       integer NOT NULL DEFAULT 0,
  last_reply_at timestamptz,
  last_error    text,
  created_by    uuid REFERENCES admins(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Discovery puts these in front of a newcomer, so it looks them up by themselves.
CREATE INDEX IF NOT EXISTS users_ai_idx ON users (last_active_at DESC)
  WHERE is_ai AND status = 'active' AND discoverable;
