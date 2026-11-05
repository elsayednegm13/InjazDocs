-- 0010 — W2 independent quotations/proforma (additive; company-wide manual numbers).
--
-- Authority: EXPORTFLOW-W2-FINAL-OWNER-DECISIONS-AND-EXECUTION-GATE-20261028
-- (SHA-256 4940eb4dc451134fb360649a392603c780aaf09ff2d3f70b5f353141d5fb9820),
-- approved 12/12 by the owner on 2026-10-28 with a separate local-code
-- authorization. Applies to synthetic isolated D1 stores owned by a test run;
-- never to the developer store, and never without that separate approval.
--
-- Decisions implemented here:
--   D-02 lifecycle: DRAFT -> ISSUED -> ACCEPTED | REJECTED | EXPIRED, 30-day
--     UTC validity (adjustable before issue), effective expiry (no cron).
--   D-03 manual quote number: UNIQUE on the normalized canonical text across
--     the whole company including archived rows; no prefix mandated.
--   D-04 permission matrix: the seven quotation keys with explicit grants per
--     role and NO inheritance from invoices/cases.
--   D-05 money: USD only, exact decimal text storage, line totals as INTEGER
--     cents, ROUND_HALF_UP at line level, subtotal = sum of line cents.
--   D-06 privacy: company/buyer identity, items, validity, payment terms;
--     NO bank data, personal phones, ID numbers, unapproved tax figures,
--     technical IDs or audit fields — those live elsewhere and are never
--     copied into quotation rows.
--   D-08 history: no physical delete; archive columns + reason; every new
--     relation RESTRICT (no hidden CASCADE), so no data loss by design.
--   D-09 provenance: copied items keep the source quotation/item id and the
--     source line value; case link is 0..1 and operational only.
--
-- Additive only and idempotent: re-applying this file changes nothing.
-- No existing table is rebuilt, no existing FK is touched, GAP-10 stays
-- BLOCKED_CONTRACT and is deliberately not part of this migration.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Permission seeds (D-04 matrix) — idempotent, additive, default deny.
-- Y = GRANT  /  N = DENY BY DEFAULT (explicit deny still outranks role grant)
--                          admin  operations_manager  export_officer  viewer
-- quotations.view            Y           Y                  Y           Y
-- quotations.create          Y           Y                  Y           N
-- quotations.edit            Y           Y                  Y           N
-- quotations.issue           Y           Y                  Y           N
-- quotations.record_response Y           Y                  N           N
-- quotations.export          Y           Y                  Y           N
-- quotations.view_all        Y           Y                  N           N
-- ---------------------------------------------------------------------------

INSERT OR IGNORE INTO permissions (key, description) VALUES
  ('quotations.view', 'View quotations the actor can access'),
  ('quotations.create', 'Create quotations and proforma documents'),
  ('quotations.edit', 'Edit draft quotations and link/unlink them to export cases'),
  ('quotations.issue', 'Issue company quotations and create revisions'),
  ('quotations.record_response', 'Record the client''s response to an issued quotation'),
  ('quotations.export', 'Export quotations as CSV and download quotation PDFs'),
  ('quotations.view_all', 'View every quotation regardless of case scope');

-- The built-in administrator mirrors ROLE_TEMPLATES.administrator = PERMISSIONS
-- in shared/permissions.ts, exactly like migration 0009 did.
INSERT OR IGNORE INTO role_permissions (role_id, permission_key)
SELECT r.id, 'quotations.view'
  FROM roles r WHERE r.key = 'administrator';
INSERT OR IGNORE INTO role_permissions (role_id, permission_key)
SELECT r.id, 'quotations.create'
  FROM roles r WHERE r.key = 'administrator';
INSERT OR IGNORE INTO role_permissions (role_id, permission_key)
SELECT r.id, 'quotations.edit'
  FROM roles r WHERE r.key = 'administrator';
INSERT OR IGNORE INTO role_permissions (role_id, permission_key)
SELECT r.id, 'quotations.issue'
  FROM roles r WHERE r.key = 'administrator';
INSERT OR IGNORE INTO role_permissions (role_id, permission_key)
SELECT r.id, 'quotations.record_response'
  FROM roles r WHERE r.key = 'administrator';
INSERT OR IGNORE INTO role_permissions (role_id, permission_key)
SELECT r.id, 'quotations.export'
  FROM roles r WHERE r.key = 'administrator';
INSERT OR IGNORE INTO role_permissions (role_id, permission_key)
SELECT r.id, 'quotations.view_all'
  FROM roles r WHERE r.key = 'administrator';

-- operations_manager: all seven keys.
INSERT OR IGNORE INTO role_permissions (role_id, permission_key)
SELECT r.id, 'quotations.view'
  FROM roles r WHERE r.key = 'operations_manager';
INSERT OR IGNORE INTO role_permissions (role_id, permission_key)
SELECT r.id, 'quotations.create'
  FROM roles r WHERE r.key = 'operations_manager';
INSERT OR IGNORE INTO role_permissions (role_id, permission_key)
SELECT r.id, 'quotations.edit'
  FROM roles r WHERE r.key = 'operations_manager';
INSERT OR IGNORE INTO role_permissions (role_id, permission_key)
SELECT r.id, 'quotations.issue'
  FROM roles r WHERE r.key = 'operations_manager';
INSERT OR IGNORE INTO role_permissions (role_id, permission_key)
SELECT r.id, 'quotations.record_response'
  FROM roles r WHERE r.key = 'operations_manager';
INSERT OR IGNORE INTO role_permissions (role_id, permission_key)
SELECT r.id, 'quotations.export'
  FROM roles r WHERE r.key = 'operations_manager';
INSERT OR IGNORE INTO role_permissions (role_id, permission_key)
SELECT r.id, 'quotations.view_all'
  FROM roles r WHERE r.key = 'operations_manager';

-- export_officer: view/create/edit/issue/export — NOT record_response, NOT view_all.
INSERT OR IGNORE INTO role_permissions (role_id, permission_key)
SELECT r.id, 'quotations.view'
  FROM roles r WHERE r.key = 'export_officer';
INSERT OR IGNORE INTO role_permissions (role_id, permission_key)
SELECT r.id, 'quotations.create'
  FROM roles r WHERE r.key = 'export_officer';
INSERT OR IGNORE INTO role_permissions (role_id, permission_key)
SELECT r.id, 'quotations.edit'
  FROM roles r WHERE r.key = 'export_officer';
INSERT OR IGNORE INTO role_permissions (role_id, permission_key)
SELECT r.id, 'quotations.issue'
  FROM roles r WHERE r.key = 'export_officer';
INSERT OR IGNORE INTO role_permissions (role_id, permission_key)
SELECT r.id, 'quotations.export'
  FROM roles r WHERE r.key = 'export_officer';

-- viewer: quotations.view only.
INSERT OR IGNORE INTO role_permissions (role_id, permission_key)
SELECT r.id, 'quotations.view'
  FROM roles r WHERE r.key = 'viewer';

-- ---------------------------------------------------------------------------
-- quotations — the independent commercial document.
-- quote_number is the normalized canonical text (trim, Arabic-Indic digits to
-- Latin, ASCII uppercase); quote_number_display keeps the exact input the
-- operator typed for display purposes only.
-- ---------------------------------------------------------------------------

CREATE TABLE quotations (
  id TEXT PRIMARY KEY,
  quote_number TEXT NOT NULL CHECK (length(quote_number) >= 1 AND length(quote_number) <= 40),
  quote_number_display TEXT NOT NULL CHECK (length(quote_number_display) >= 1 AND length(quote_number_display) <= 40),
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  title TEXT CHECK (title IS NULL OR length(title) <= 300),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  incoterm TEXT CHECK (incoterm IS NULL OR length(incoterm) <= 20),
  payment_terms TEXT CHECK (payment_terms IS NULL OR length(payment_terms) <= 1000),
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 1000),
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'ISSUED', 'ACCEPTED', 'REJECTED', 'EXPIRED')),
  validity_days INTEGER NOT NULL DEFAULT 30 CHECK (validity_days >= 1 AND validity_days <= 365),
  issued_at TEXT,
  valid_until TEXT,
  client_response TEXT CHECK (client_response IS NULL OR client_response IN ('ACCEPTED', 'REJECTED')),
  client_response_at TEXT,
  client_response_by TEXT REFERENCES user(id) ON DELETE RESTRICT,
  case_id TEXT REFERENCES export_cases(id) ON DELETE RESTRICT,
  created_by TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
  archived_at TEXT,
  archived_by TEXT REFERENCES user(id) ON DELETE RESTRICT,
  archived_reason TEXT CHECK (archived_reason IS NULL OR length(archived_reason) >= 3 AND length(archived_reason) <= 500),
  subtotal_minor INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_minor >= 0),
  currency_minor_decimals INTEGER NOT NULL DEFAULT 2 CHECK (currency_minor_decimals = 2),
  active_revision INTEGER NOT NULL DEFAULT 0 CHECK (active_revision >= 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (quote_number)
);

CREATE INDEX quotations_case_idx ON quotations(case_id, created_at);
CREATE INDEX quotations_customer_idx ON quotations(customer_id, created_at);
CREATE INDEX quotations_status_idx ON quotations(status, created_at);
CREATE INDEX quotations_creator_idx ON quotations(created_by, created_at);

-- ---------------------------------------------------------------------------
-- quotation_items — one row per position per revision. Items of an older
-- revision are immutable rows: a revision never rewrites them; the new
-- revision writes its own rows with revision = previous + 1. `position` keeps
-- the ordering inside one revision; `line_total_minor` is INTEGER cents.
-- Provenance (D-09) keeps the source quotation/item id and the source line
-- value at copy time; the source rows are never modified by a copy.
-- ---------------------------------------------------------------------------

CREATE TABLE quotation_items (
  id TEXT PRIMARY KEY,
  quotation_id TEXT NOT NULL REFERENCES quotations(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  position INTEGER NOT NULL CHECK (position >= 1),
  description TEXT NOT NULL CHECK (length(trim(description)) > 0 AND length(description) <= 500),
  quantity_text TEXT NOT NULL CHECK (quantity_text GLOB '[0-9]*'),
  quantity_minor INTEGER NOT NULL CHECK (quantity_minor >= 0),
  unit_label TEXT CHECK (unit_label IS NULL OR length(unit_label) <= 20),
  unit_price_text TEXT NOT NULL CHECK (unit_price_text GLOB '[0-9]*'),
  unit_price_minor_4 INTEGER NOT NULL CHECK (unit_price_minor_4 >= 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  line_total_minor INTEGER NOT NULL CHECK (line_total_minor >= 0),
  source_quotation_id TEXT REFERENCES quotations(id) ON DELETE RESTRICT,
  source_item_id TEXT REFERENCES quotation_items(id) ON DELETE RESTRICT,
  source_line_total_minor INTEGER CHECK (source_line_total_minor IS NULL OR source_line_total_minor >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (quotation_id, revision, position)
);

CREATE INDEX quotation_items_source_idx ON quotation_items(source_item_id);

-- ---------------------------------------------------------------------------
-- quotation_revisions — the immutable issued snapshot chain (D-09).
-- snapshot_json holds the complete issued state: items (description, quantity
-- text, unit label, unit price text, line total), subtotal, currency, company
-- name, buyer display name and commercial address, and the export case
-- reference only if the case was already linked when this revision was issued.
-- The PDF renderer reads this snapshot, so a later case link can never change
-- an already issued document.
-- ---------------------------------------------------------------------------

CREATE TABLE quotation_revisions (
  id TEXT PRIMARY KEY,
  quotation_id TEXT NOT NULL REFERENCES quotations(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  reason TEXT NOT NULL CHECK (length(trim(reason)) >= 3 AND length(reason) <= 500),
  actor_id TEXT REFERENCES user(id) ON DELETE RESTRICT,
  issued_at TEXT NOT NULL,
  valid_until TEXT NOT NULL,
  company_name TEXT NOT NULL CHECK (length(company_name) >= 1 AND length(company_name) <= 200),
  customer_name TEXT NOT NULL CHECK (length(customer_name) >= 1 AND length(customer_name) <= 200),
  customer_address TEXT CHECK (customer_address IS NULL OR length(customer_address) <= 500),
  case_reference TEXT CHECK (case_reference IS NULL OR length(case_reference) <= 40),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  subtotal_minor INTEGER NOT NULL CHECK (subtotal_minor >= 0),
  snapshot_json TEXT NOT NULL,
  before_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (quotation_id, revision)
);

CREATE INDEX quotation_revisions_quotation_idx ON quotation_revisions(quotation_id, created_at);
