-- Logic overhaul: discovery ranking and fairness, trust and shadow bans, referral abuse, premium
-- expiry, matches that go quiet, random chat ratings, Wall quotas, and one-off packs in the store.

-- ---------------------------------------------------------------- users
ALTER TABLE users
  -- the user chose their age range themselves; until then it is only a ranking preference and
  -- never hides them from (or hides from them) people who didn't ask for that
  ADD COLUMN pref_age_set      boolean  NOT NULL DEFAULT false,
  -- 0..100: verification, account age, random-chat ratings, reports by distinct people
  ADD COLUMN trust             smallint NOT NULL DEFAULT 50,
  -- shadow ban set automatically (several reports in a day) and waiting for a moderator
  ADD COLUMN shadow_auto       boolean  NOT NULL DEFAULT false,
  ADD COLUMN shadow_at         timestamptz,
  -- likes received, each weighted by how selective the person who liked is
  ADD COLUMN like_weight       real     NOT NULL DEFAULT 0,
  -- conversations someone else opened with this user / the ones they answered
  ADD COLUMN openers_received  integer  NOT NULL DEFAULT 0,
  ADD COLUMN replies_given     integer  NOT NULL DEFAULT 0,
  -- 👍 / 👎 from random-chat partners
  ADD COLUMN rc_up             integer  NOT NULL DEFAULT 0,
  ADD COLUMN rc_down           integer  NOT NULL DEFAULT 0,
  -- boosts bought one by one (premium members also get a free one every day)
  ADD COLUMN boost_credits     integer  NOT NULL DEFAULT 0 CHECK (boost_credits >= 0);

UPDATE users SET like_weight = likes_received;
-- whoever already moved the age range away from the old 18–45 default chose it
UPDATE users SET pref_age_set = true WHERE (pref_min_age, pref_max_age) <> (18, 45);
-- everyone else: a suggested range around their own age (shown in the filters, not enforced)
UPDATE users SET
  pref_min_age = greatest(18, date_part('year', age(birthdate))::int - 10),
  pref_max_age = least(99, date_part('year', age(birthdate))::int + 10)
WHERE NOT pref_age_set AND birthdate IS NOT NULL;

-- admin: accounts shadow-banned automatically, newest first
CREATE INDEX users_shadow_auto_idx ON users (shadow_at DESC) WHERE shadow_auto;

-- ---------------------------------------------------------------- matches & messages
ALTER TABLE matches ADD COLUMN nudged_at timestamptz;
-- «nobody said hello yet»: reminders after a day, archived after two weeks
CREATE INDEX matches_silent_idx ON matches (created_at) WHERE status = 'active' AND message_count = 0;

ALTER TABLE match_members ADD COLUMN archived boolean NOT NULL DEFAULT false;

-- a message from a shadow-banned sender: stored so they still see it, shown to nobody else
ALTER TABLE messages ADD COLUMN ghost boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------- referrals
ALTER TABLE referrals DROP CONSTRAINT referrals_status_check;
ALTER TABLE referrals ADD CONSTRAINT referrals_status_check CHECK (status IN ('joined', 'qualified', 'revoked'));
-- what the inviter was given for this friend (taken back if the friend turns out to be fake)
ALTER TABLE referrals
  ADD COLUMN reward_superlikes   integer NOT NULL DEFAULT 0,
  ADD COLUMN reward_premium_days integer NOT NULL DEFAULT 0;
CREATE INDEX referrals_qualified_idx ON referrals (inviter_id, qualified_at DESC) WHERE status = 'qualified';

-- ---------------------------------------------------------------- the Wall
-- 'expired': the post ended before the author answered (the sender's quota is given back);
-- 'ghost': sent by a shadow-banned user — they see it as waiting, the author never does
ALTER TABLE wall_chat_requests DROP CONSTRAINT wall_chat_requests_status_check;
ALTER TABLE wall_chat_requests ADD CONSTRAINT wall_chat_requests_status_check
  CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'expired', 'ghost'));
ALTER TABLE wall_chat_requests ADD COLUMN reminded_at timestamptz;
ALTER TABLE wall_posts ADD COLUMN edited_at timestamptz;

-- ---------------------------------------------------------------- store
-- besides premium plans: packs of boosts or super likes, bought once
ALTER TABLE plans
  ADD COLUMN kind     text    NOT NULL DEFAULT 'premium' CHECK (kind IN ('premium', 'boost', 'superlikes')),
  ADD COLUMN quantity integer NOT NULL DEFAULT 0 CHECK (quantity >= 0);
ALTER TABLE plans DROP CONSTRAINT plans_duration_days_check;
ALTER TABLE plans ADD CONSTRAINT plans_shape_check
  CHECK ((kind = 'premium' AND duration_days > 0) OR (kind <> 'premium' AND quantity > 0));

-- ---------------------------------------------------------------- photos
-- photos are live at once; these order the moderators' review queue. 'pending' now means «hidden
-- until a moderator looks» (several people reported the profile's photos)
ALTER TABLE photos
  ADD COLUMN risk    smallint NOT NULL DEFAULT 0,
  ADD COLUMN flagged boolean  NOT NULL DEFAULT false;
CREATE INDEX photos_review_idx ON photos (created_at DESC) WHERE status = 'approved' AND reviewed_at IS NULL;
