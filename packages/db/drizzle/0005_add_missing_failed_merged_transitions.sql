-- Add missing terminal-state transitions.
-- The orchestrator can reach "approved" and "pr_created" in the DB
-- but previously had no escape hatch to "failed" or "merged" from those states.
-- Also: pr_tracking states are never persisted to DB, so the merge path
-- needs pr_created → merged (not just merge_ready → merged).
INSERT INTO task_valid_transitions (from_state, to_state) VALUES
  ('approved',   'failed'),
  ('pr_created', 'failed'),
  ('pr_created', 'merged')
ON CONFLICT DO NOTHING;
