ALTER TABLE runs ADD COLUMN archived integer NOT NULL DEFAULT 0 CHECK (archived IN (0, 1));
--> statement-breakpoint
CREATE TABLE deleted_runs (
  run_id text NOT NULL,
  tester_id text NOT NULL,
  deleted_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (run_id, tester_id)
);
--> statement-breakpoint
CREATE TRIGGER reject_deleted_run BEFORE INSERT ON runs
WHEN EXISTS (SELECT 1 FROM deleted_runs WHERE run_id = NEW.run_id AND tester_id = NEW.tester_id)
BEGIN
  SELECT RAISE(ABORT, 'run_scope_deleted');
END;
