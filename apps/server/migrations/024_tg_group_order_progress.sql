-- Resume without inviting the same person twice, and detect a worker that died mid-run.
ALTER TABLE tg_group_order_runs
  ADD COLUMN IF NOT EXISTS heartbeat timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS claim text,
  ADD COLUMN IF NOT EXISTS not_before timestamptz;

CREATE INDEX IF NOT EXISTS tg_group_order_runs_stale
  ON tg_group_order_runs (heartbeat)
  WHERE status = 'running';

CREATE TABLE IF NOT EXISTS tg_group_order_invites (
  order_id   uuid NOT NULL REFERENCES tg_group_orders (id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  tg_id      bigint NOT NULL,
  outcome    text NOT NULL CHECK (outcome IN ('invited', 'skipped', 'failed')),
  detail     text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, user_id, tg_id)
);