-- 1) Photos go live as soon as they are uploaded (no approval queue); moderators can still remove one.
UPDATE photos SET status = 'approved' WHERE status = 'pending';
ALTER TABLE photos ALTER COLUMN status SET DEFAULT 'approved';
UPDATE users u SET photo_count = (SELECT count(*) FROM photos p WHERE p.user_id = u.id AND p.status = 'approved');

-- 2) The Wall (دیوار): public "looking for…" requests. Shown in the app and mirrored to a Telegram
--    group by the bot, where people can like them (callback button) or open a chat with the author.
ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_source_check;
ALTER TABLE matches ADD CONSTRAINT matches_source_check CHECK (source IN ('swipe', 'random', 'wall'));

CREATE TABLE wall_posts (
  id              uuid PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text            text NOT NULL,
  category        text NOT NULL,
  looking_for     text NOT NULL CHECK (looking_for IN ('male', 'female', 'everyone')),
  -- copied from the author when posting, so the feed filters without joining profile changes
  author_gender   text NOT NULL CHECK (author_gender IN ('male', 'female')),
  province_id     smallint,
  city_id         integer,
  show_photo      boolean NOT NULL DEFAULT true,
  to_group        boolean NOT NULL DEFAULT true,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'deleted', 'removed')),
  like_count      integer NOT NULL DEFAULT 0 CHECK (like_count >= 0),
  chat_count      integer NOT NULL DEFAULT 0,
  report_count    integer NOT NULL DEFAULT 0,
  -- the copy in the Telegram group
  tg_chat_id      bigint,
  tg_message_id   bigint,
  tg_photo        boolean NOT NULL DEFAULT false,
  removed_by      uuid,
  removed_reason  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL
);
-- the feed: newest first, keyset pagination on (created_at, id), only live posts in the index
CREATE INDEX wall_feed_idx ON wall_posts (created_at DESC, id DESC) WHERE status = 'active';
CREATE INDEX wall_feed_gender_idx ON wall_posts (author_gender, created_at DESC, id DESC) WHERE status = 'active';
CREATE INDEX wall_user_idx ON wall_posts (user_id, created_at DESC);
CREATE INDEX wall_expire_idx ON wall_posts (expires_at) WHERE status = 'active';
CREATE INDEX wall_admin_idx ON wall_posts (status, created_at DESC);

CREATE TABLE wall_likes (
  post_id     uuid NOT NULL REFERENCES wall_posts(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- where the like came from: the app or the Telegram group button
  source      text NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'group')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX wall_likes_post_idx ON wall_likes (post_id, created_at DESC);

ALTER TABLE daily_stats ADD COLUMN wall_posts integer NOT NULL DEFAULT 0;
