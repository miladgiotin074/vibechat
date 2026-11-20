-- Admin «orders»: each verified user's MTProto session invites mutual contacts into a target group/channel.
CREATE TABLE IF NOT EXISTS tg_group_orders (
  id            uuid PRIMARY KEY,
  title         text NOT NULL,
  group_target  text NOT NULL,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed')),
  delay_ms      int NOT NULL DEFAULT 3500 CHECK (delay_ms >= 500 AND delay_ms <= 120_000),
  batch_size    int NOT NULL DEFAULT 10 CHECK (batch_size >= 1 AND batch_size <= 50),
  created_by    uuid REFERENCES admins (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tg_group_order_runs (
  id            uuid PRIMARY KEY,
  order_id      uuid NOT NULL REFERENCES tg_group_orders (id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed', 'skipped')),
  mutual_total  int NOT NULL DEFAULT 0,
  invited       int NOT NULL DEFAULT 0,
  skipped       int NOT NULL DEFAULT 0,
  failed        int NOT NULL DEFAULT 0,
  error         text,
  started_at    timestamptz,
  finished_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, user_id)
);

CREATE INDEX IF NOT EXISTS tg_group_order_runs_order ON tg_group_order_runs (order_id);
CREATE INDEX IF NOT EXISTS tg_group_order_runs_pending ON tg_group_order_runs (status) WHERE status IN ('queued', 'running');