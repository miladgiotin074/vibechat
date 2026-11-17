-- The app becomes one simple thing: you look at a profile and either write to that person or skip
-- them. No likes, no super likes, no matching, no paid membership, no location, and a profile that
-- is a photo, a name, an age, a marital status and a few words.

-- ---------------------------------------------------------------- discovery: message or skip
-- People I passed over. (A conversation of ours is remembered in match_members, so discovery
-- leaves out everyone I already write to without a row here.)
CREATE TABLE IF NOT EXISTS skips (
  user_id     uuid NOT NULL,
  target_id   uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, target_id)
);
-- the passes people already made carry over; their likes have no meaning any more
INSERT INTO skips (user_id, target_id, created_at)
  SELECT swiper_id, target_id, created_at FROM swipes WHERE action = 0
  ON CONFLICT DO NOTHING;
DROP TABLE IF EXISTS swipes CASCADE;

-- A conversation now starts with a message from discovery, or from the Wall.
ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_source_check;
ALTER TABLE matches ADD CONSTRAINT matches_source_check CHECK (source IN ('swipe', 'random', 'wall', 'message'));

-- ---------------------------------------------------------------- nothing is for sale
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS plans CASCADE;

-- ---------------------------------------------------------------- the Wall, the same way
-- Writing to someone is simply writing to them: no request to accept, and no ladder to climb.
DROP TABLE IF EXISTS wall_chat_requests CASCADE;
ALTER TABLE wall_posts DROP COLUMN IF EXISTS bumped_at;
ALTER TABLE wall_posts DROP COLUMN IF EXISTS category;
ALTER TABLE wall_posts DROP COLUMN IF EXISTS province_id;
ALTER TABLE wall_posts DROP COLUMN IF EXISTS city_id;
ALTER TABLE wall_posts DROP COLUMN IF EXISTS accepted_count;

-- ---------------------------------------------------------------- invites had likes to give
DROP TABLE IF EXISTS group_adds CASCADE;
DROP TABLE IF EXISTS referrals CASCADE;

-- ---------------------------------------------------------------- the profile
DROP INDEX IF EXISTS users_discover_province_idx;
DROP INDEX IF EXISTS users_discover_city_idx;
DROP INDEX IF EXISTS users_geo_idx;

ALTER TABLE users
  DROP COLUMN IF EXISTS goal,
  DROP COLUMN IF EXISTS job,
  DROP COLUMN IF EXISTS education,
  DROP COLUMN IF EXISTS height_cm,
  DROP COLUMN IF EXISTS smoking,
  DROP COLUMN IF EXISTS interests,
  DROP COLUMN IF EXISTS province_id,
  DROP COLUMN IF EXISTS city_id,
  DROP COLUMN IF EXISTS lat,
  DROP COLUMN IF EXISTS lng,
  DROP COLUMN IF EXISTS location_at,
  DROP COLUMN IF EXISTS hide_distance,
  DROP COLUMN IF EXISTS pref_scope,
  DROP COLUMN IF EXISTS pref_max_km,
  DROP COLUMN IF EXISTS pref_verified_only,
  DROP COLUMN IF EXISTS is_verified,
  -- membership and everything it used to buy
  DROP COLUMN IF EXISTS premium_until,
  DROP COLUMN IF EXISTS boost_until,
  DROP COLUMN IF EXISTS boost_credits,
  DROP COLUMN IF EXISTS bonus_superlikes,
  DROP COLUMN IF EXISTS superlikes_used,
  DROP COLUMN IF EXISTS likes_used,
  DROP COLUMN IF EXISTS incognito,
  -- how much people were liked, and how selective they were
  DROP COLUMN IF EXISTS likes_received,
  DROP COLUMN IF EXISTS passes_received,
  DROP COLUMN IF EXISTS like_weight,
  DROP COLUMN IF EXISTS score,
  -- there are no matches or likes left to be notified about
  DROP COLUMN IF EXISTS notify_matches,
  DROP COLUMN IF EXISTS notify_likes;

-- discovery reads this one index: the people who can be shown, newest-active first
CREATE INDEX IF NOT EXISTS users_discover_idx ON users (gender, last_active_at DESC)
  WHERE status = 'active' AND discoverable AND NOT shadow_banned AND photo_count > 0;

-- ---------------------------------------------------------------- settings and bot pictures
UPDATE app_settings SET value = value
  - 'freeLikes' - 'premiumDailyLikes' - 'freeSuperLikes' - 'premiumDailySuperLikes' - 'boostMinutes'
  - 'paymentsEnabled' - 'referral' - 'vibeNight' - 'growth'
WHERE key = 'app';
UPDATE app_settings SET value = value #- '{wall,bumpCooldownHours}' #- '{wall,premiumDailyChats}' #- '{wall,newcomerSpotlightHours}'
WHERE key = 'app';
DELETE FROM bot_media WHERE slot IN ('like', 'super_like', 'match', 'premium', 'referral', 'vibe_night', 'invite', 'wall_request', 'wall_accept');
