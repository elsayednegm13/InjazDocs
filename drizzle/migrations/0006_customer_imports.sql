-- Import operations make a customer CSV import resumable and auditable.
-- The operation id is supplied by the caller, so a retry of the same import
-- continues the same operation instead of creating a second set of customers.
CREATE TABLE IF NOT EXISTS customer_import_operations (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'COMPLETED', 'PARTIAL')),
  total_rows INTEGER NOT NULL,
  imported_rows INTEGER NOT NULL DEFAULT 0,
  failed_rows INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_import_rows (
  id TEXT PRIMARY KEY,
  import_id TEXT NOT NULL REFERENCES customer_import_operations(id) ON DELETE CASCADE,
  row_index INTEGER NOT NULL,
  legal_name TEXT,
  status TEXT NOT NULL CHECK (status IN ('IMPORTED', 'FAILED')),
  customer_id TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (import_id, row_index)
);

CREATE INDEX IF NOT EXISTS customer_import_rows_import_idx ON customer_import_rows(import_id);
CREATE INDEX IF NOT EXISTS customer_import_operations_actor_idx ON customer_import_operations(actor_id, created_at);
