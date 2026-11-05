-- ET-2026-10-21: durable replay witness, import file identity and compensation incidents.
--
-- Forward-only and additive. No existing row is rewritten and no historical
-- migration is edited. Existing completed idempotency rows keep their witness
-- (the row itself) but have no independent response-retention timestamp, so
-- replay of a legacy row fails closed instead of guessing.

-- The idempotency row is the durable effect witness. `expires_at` is the
-- witness lifetime; `response_expires_at` is the much shorter lifetime of the
-- cached protected response body. The body can be purged while the witness
-- stays, which is what prevents a role edit or cache expiry from allowing a
-- second business effect.
ALTER TABLE idempotency_keys ADD COLUMN response_expires_at TEXT;
ALTER TABLE idempotency_keys ADD COLUMN outcome_class TEXT;
ALTER TABLE idempotency_keys ADD COLUMN effect_ref TEXT;

-- One import operation is bound to exactly one canonical parsed file. The
-- fingerprint is SHA-256 over the versioned canonical structure, never the
-- filename or raw CSV bytes.
ALTER TABLE customer_import_operations ADD COLUMN file_fingerprint TEXT;
ALTER TABLE customer_import_operations ADD COLUMN parser_version TEXT;

-- Minimal, redacted incident record for a compensation path that failed after
-- an identity write. No credentials, passwords, cookies or raw SQL are stored.
CREATE TABLE IF NOT EXISTS auth_compensation_incidents (
  id TEXT PRIMARY KEY,
  correlation_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('BOOTSTRAP', 'USER_CREATE')),
  stage TEXT NOT NULL,
  residual_user_id TEXT,
  detail TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS auth_compensation_incidents_open_idx
  ON auth_compensation_incidents(created_at) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idempotency_keys_witness_idx
  ON idempotency_keys(expires_at);
