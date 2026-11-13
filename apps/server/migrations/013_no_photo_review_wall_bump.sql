-- Photo review is gone: photos that users' reports had hidden (waiting for a moderator) come back.
UPDATE photos SET status = 'approved' WHERE status = 'pending';
UPDATE users u SET photo_count = (SELECT count(*) FROM photos p WHERE p.user_id = u.id AND p.status = 'approved')
WHERE EXISTS (SELECT 1 FROM photos p WHERE p.user_id = u.id);
UPDATE app_settings SET value = value #- '{safety,photoReportsToHide}' WHERE key = 'app';

-- The Wall's «bump» (members): a request moves back to the top. The feed is ordered by sort_at,
-- which is the posting time until the request is bumped.
ALTER TABLE wall_posts ADD COLUMN IF NOT EXISTS bumped_at timestamptz;
ALTER TABLE wall_posts ADD COLUMN IF NOT EXISTS sort_at timestamptz;
UPDATE wall_posts SET sort_at = created_at WHERE sort_at IS NULL;
ALTER TABLE wall_posts ALTER COLUMN sort_at SET DEFAULT now();
ALTER TABLE wall_posts ALTER COLUMN sort_at SET NOT NULL;

DROP INDEX IF EXISTS wall_feed_idx;
DROP INDEX IF EXISTS wall_feed_gender_idx;
CREATE INDEX wall_feed_idx ON wall_posts (sort_at DESC, id DESC) WHERE status = 'active';
CREATE INDEX wall_feed_gender_idx ON wall_posts (author_gender, sort_at DESC, id DESC) WHERE status = 'active';
