-- An announcement can carry its own picture (instead of the «announcement» bot image) and one
-- glass button under it (any text, any link — support, a channel, the app itself).
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS image_key text;
-- a small preview (data URL) so the panel can show the picture without a public media URL
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS image_preview text;
-- Telegram's id for the uploaded picture: the first message uploads it, the rest name it
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS tg_file_id text;
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS tg_file_bot text;
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS button_text text;
-- empty with a button_text: the button opens the Mini App
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS button_url text;
