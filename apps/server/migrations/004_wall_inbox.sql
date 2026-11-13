-- Wall: one inbox for every conversation request a user received (across all their posts),
-- newest first; the «sent» side already has wall_req_from_idx.
CREATE INDEX wall_req_to_idx ON wall_chat_requests (to_id, created_at DESC);
