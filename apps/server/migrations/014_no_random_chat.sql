-- The random chat is gone: its settings, the referral's chat reward and the per-user counters go
-- with it. Matches made there keep source = 'random' and their origin (the check stays as it is);
-- the live sessions and queues were only ever in Redis and expire on their own.
UPDATE app_settings SET value = value #- '{randomChat}' WHERE key = 'app';
UPDATE app_settings SET value = value #- '{referral,rewardChats}' WHERE key = 'app';
ALTER TABLE users DROP COLUMN IF EXISTS rc_used;
ALTER TABLE users DROP COLUMN IF EXISTS rc_up;
ALTER TABLE users DROP COLUMN IF EXISTS rc_down;
