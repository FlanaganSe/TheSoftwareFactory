-- Add missing evidence_ready → failed transition.
-- Allows cleanup to persist terminal "failed" state when the pipeline
-- fails after the evidence phase (e.g., review rejection, 0-change guard).
INSERT INTO task_valid_transitions (from_state, to_state) VALUES
  ('evidence_ready', 'failed')
ON CONFLICT DO NOTHING;
