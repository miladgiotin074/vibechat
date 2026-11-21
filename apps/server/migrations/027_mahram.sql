-- «محرم»: a user an admin trusts with one extra power — choosing, in Discover, to see the
-- accounts that are not verified (or only those). Nobody else is offered that filter, and the
-- server refuses the setting from anyone whose row does not say `mahram`.
--
-- Everyone's deck is unchanged by this: the default stays 'all'.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS mahram boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pref_verified text NOT NULL DEFAULT 'all'
    CHECK (pref_verified IN ('all', 'verified', 'unverified'));
