CREATE INDEX IF NOT EXISTS case_events_created_idx
  ON case_events(created_at DESC, case_id);
