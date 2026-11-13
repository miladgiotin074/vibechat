-- Until someone picks an age range themselves, discovery shows every age: the stored range is the
-- full one (it used to be a suggestion of ±10 years around their own age).
ALTER TABLE users ALTER COLUMN pref_max_age SET DEFAULT 99;
UPDATE users SET pref_min_age = 18, pref_max_age = 99 WHERE NOT pref_age_set;
