-- Where a conversation started, shown at the top of the chat:
--   {"kind": "like" | "superlike", "by": <who liked first / who sent the super like>}
--   {"kind": "random"}
--   {"kind": "wall", "postId", "author", "requester", "text", "category"}
ALTER TABLE matches ADD COLUMN origin jsonb;

-- When this member first opened the other one's profile after matching
-- (the other one is told once, inside the chat).
ALTER TABLE match_members ADD COLUMN viewed_peer_at timestamptz;

-- ---------------------------------------------------------------- what we can tell for older chats
UPDATE matches SET origin = '{"kind": "random"}' WHERE source = 'random' AND origin IS NULL;

UPDATE matches m SET origin = (
  SELECT jsonb_build_object('kind', 'wall', 'postId', p.id, 'author', p.user_id, 'requester', r.from_id,
                            'text', left(p.text, 160), 'category', p.category)
  FROM wall_chat_requests r JOIN wall_posts p ON p.id = r.post_id
  WHERE r.status = 'accepted'
    AND (r.match_id = m.id OR (r.from_id IN (m.user_a, m.user_b) AND r.to_id IN (m.user_a, m.user_b)))
  ORDER BY (r.match_id = m.id) DESC, r.decided_at DESC NULLS LAST
  LIMIT 1)
WHERE m.source = 'wall' AND m.origin IS NULL;
UPDATE matches SET origin = '{"kind": "wall"}' WHERE source = 'wall' AND origin IS NULL;

UPDATE matches m SET origin = coalesce(
  -- a super like, if either of them sent one
  (SELECT jsonb_build_object('kind', 'superlike', 'by', s.swiper_id) FROM swipes s
   WHERE s.action = 2 AND ((s.swiper_id = m.user_a AND s.target_id = m.user_b) OR (s.swiper_id = m.user_b AND s.target_id = m.user_a))
   ORDER BY s.created_at LIMIT 1),
  -- otherwise whoever liked first
  (SELECT jsonb_build_object('kind', 'like', 'by', s.swiper_id) FROM swipes s
   WHERE s.action > 0 AND ((s.swiper_id = m.user_a AND s.target_id = m.user_b) OR (s.swiper_id = m.user_b AND s.target_id = m.user_a))
   ORDER BY s.created_at LIMIT 1),
  '{"kind": "like"}')
WHERE m.source = 'swipe' AND m.origin IS NULL;
