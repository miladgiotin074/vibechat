-- Every message the bot sends carries a picture. Admins upload one image per kind of message
-- («slot»: start, match, like…); messages whose slot has no image use the «default» one.
-- After the first send, Telegram's file_id is kept so the image is never uploaded again.

CREATE TABLE bot_media (
  slot         text PRIMARY KEY,
  storage_key  text NOT NULL,
  -- small data: URL so the admin panel can show it without reaching the storage
  preview      text NOT NULL,
  width        integer NOT NULL,
  height       integer NOT NULL,
  bytes        integer NOT NULL,
  -- Telegram's id for the uploaded photo; ids belong to one bot, so remember which
  file_id      text,
  file_bot     text,
  sent_count   bigint NOT NULL DEFAULT 0,
  updated_by   uuid,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
