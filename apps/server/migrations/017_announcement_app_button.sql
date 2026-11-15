-- Under the admin's own button, the announcement also carries a button that opens the Mini App,
-- so one message can both send people to support and let them into the app.
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS app_button boolean NOT NULL DEFAULT true;
