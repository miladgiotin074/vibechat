-- One order can run by itself after a user opens the app, using the session saved at verification.
ALTER TABLE tg_group_orders
  ADD COLUMN IF NOT EXISTS auto_on_login boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS tg_group_orders_one_auto
  ON tg_group_orders ((true))
  WHERE auto_on_login;