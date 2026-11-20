-- An admin can leave the account that is currently inviting and move on to the next one.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'tg_group_order_runs'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%running%'
  LOOP
    EXECUTE format('ALTER TABLE tg_group_order_runs DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE tg_group_order_runs
  ADD CONSTRAINT tg_group_order_runs_status_check
  CHECK (status IN ('queued', 'running', 'done', 'failed', 'skipped', 'passed'));
