-- Idempotency ledger for state-changing API requests.
-- The row is claimed before the handler runs and is scoped to the authenticated
-- user plus the client-supplied Idempotency-Key. Completed responses are replayed
-- without re-running the handler or any of its side effects.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('IN_PROGRESS', 'COMPLETED', 'UNKNOWN')),
  status_code INTEGER,
  response_body TEXT,
  response_type TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE (actor_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idempotency_keys_expires_idx ON idempotency_keys(expires_at);
