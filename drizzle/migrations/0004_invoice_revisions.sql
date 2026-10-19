INSERT INTO permissions (key, description)
VALUES ('invoices.correct_completed', 'Correct an invoice after its export operation is completed');

INSERT INTO role_permissions (role_id, permission_key)
VALUES ('role-admin', 'invoices.correct_completed');

CREATE TABLE invoice_revisions (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES export_invoices(id),
  case_id TEXT NOT NULL REFERENCES export_cases(id),
  revision INTEGER NOT NULL,
  reason TEXT NOT NULL,
  actor_id TEXT REFERENCES user(id),
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (invoice_id, revision)
);

CREATE INDEX invoice_revisions_case_idx ON invoice_revisions(case_id, created_at);
