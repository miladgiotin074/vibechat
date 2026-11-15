-- An announcement's text may be written in Markdown (turned into Telegram HTML when it is sent),
-- and the bot can pin it in each user's chat for a while.
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS markdown boolean NOT NULL DEFAULT false;
-- hours the bot keeps it pinned in the user's private chat (0 = don't pin)
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS pin_hours int NOT NULL DEFAULT 0;
