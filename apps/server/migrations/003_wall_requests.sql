-- Wall: answering a request no longer opens a conversation directly. The reader sends a short
-- intro as a «chat request»; only when the request's author accepts it does a conversation start
-- (with that intro as its first message). Declined requests stay declined for that post.

CREATE TABLE wall_chat_requests (
  id          uuid PRIMARY KEY,
  post_id     uuid NOT NULL REFERENCES wall_posts (id) ON DELETE CASCADE,
  from_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  to_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  text        text NOT NULL,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  match_id    uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  decided_at  timestamptz,
  UNIQUE (post_id, from_id)
);
-- the author's inbox per request, newest first
CREATE INDEX wall_req_post_idx ON wall_chat_requests (post_id, created_at DESC);
-- «n requests waiting» badge across all of an author's requests
CREATE INDEX wall_req_pending_idx ON wall_chat_requests (to_id) WHERE status = 'pending';
-- daily quota and «what did I send» for the sender
CREATE INDEX wall_req_from_idx ON wall_chat_requests (from_id, created_at DESC);

-- chat_count now counts conversation requests received; accepted ones are counted apart
ALTER TABLE wall_posts ADD COLUMN accepted_count integer NOT NULL DEFAULT 0;
