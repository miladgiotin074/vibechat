-- Discovery follows the random chat's rules: a man without membership has a number of likes and
-- super likes in total (not per day); more likes come from adding friends to the Wall group.
ALTER TABLE users ADD COLUMN IF NOT EXISTS likes_used int NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS superlikes_used int NOT NULL DEFAULT 0;

-- the per-day free quotas are gone
UPDATE app_settings SET value = value - 'freeDailyLikes' - 'freeDailyLikesFemale' - 'freeDailySuperLikes' WHERE key = 'app';
