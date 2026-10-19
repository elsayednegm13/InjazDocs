-- ExportFlow D1 schema. Foreign keys are enforced locally by wrangler/D1.
PRAGMA foreign_keys = ON;

CREATE TABLE user (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  email_verified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  disabled_at INTEGER
);

CREATE TABLE session (
  id TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
);
CREATE INDEX session_user_id_idx ON session(user_id);

CREATE TABLE account (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  access_token_expires_at INTEGER,
  refresh_token_expires_at INTEGER,
  scope TEXT,
  password TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX account_user_id_idx ON account(user_id);

CREATE TABLE verification (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name_en TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE permissions (
  key TEXT PRIMARY KEY,
  description TEXT NOT NULL
);

CREATE TABLE role_permissions (
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL REFERENCES permissions(key),
  PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE user_roles (
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE user_permission_overrides (
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL REFERENCES permissions(key),
  effect TEXT NOT NULL CHECK (effect IN ('GRANT', 'DENY')),
  PRIMARY KEY (user_id, permission_key)
);

CREATE TABLE user_preferences (
  user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'ar')),
  timezone TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE company_settings (
  id TEXT PRIMARY KEY,
  exporter_display_name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Africa/Cairo',
  incoterms_edition TEXT NOT NULL DEFAULT 'Incoterms 2020',
  max_upload_bytes INTEGER NOT NULL DEFAULT 419430400,
  currency_default TEXT NOT NULL DEFAULT 'USD',
  updated_at TEXT NOT NULL
);

CREATE TABLE ports (
  id TEXT PRIMARY KEY,
  unlocode TEXT,
  name TEXT NOT NULL,
  country_code TEXT,
  is_custom INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ports_unlocode_idx ON ports(unlocode) WHERE unlocode IS NOT NULL;

CREATE TABLE payment_term_types (
  code TEXT PRIMARY KEY,
  name_en TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  requires_due_days INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  legal_name TEXT NOT NULL,
  trade_name TEXT,
  country_code TEXT,
  notes TEXT,
  archived_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT REFERENCES user(id)
);
CREATE INDEX customers_name_idx ON customers(legal_name);

CREATE TABLE customer_contacts (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  title TEXT,
  email TEXT,
  phone TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE customer_addresses (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('BILLING', 'SHIPPING', 'OTHER')),
  line1 TEXT NOT NULL,
  line2 TEXT,
  city TEXT,
  region TEXT,
  postal_code TEXT,
  country_code TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE customer_bank_accounts (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  bank_name TEXT NOT NULL,
  account_name TEXT,
  account_number_last4 TEXT,
  iban_last4 TEXT,
  swift TEXT,
  restricted_notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE export_cases (
  id TEXT PRIMARY KEY,
  case_reference TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  status TEXT NOT NULL,
  document_route TEXT NOT NULL,
  bank_path_status TEXT NOT NULL,
  direct_path_status TEXT,
  assigned_to TEXT REFERENCES user(id),
  destination_country TEXT,
  next_action TEXT,
  closed_at TEXT,
  close_exception_reason TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT REFERENCES user(id)
);
CREATE INDEX export_cases_status_idx ON export_cases(status, updated_at);
CREATE INDEX export_cases_assignee_idx ON export_cases(assigned_to);

CREATE TABLE export_case_customer_snapshots (
  case_id TEXT PRIMARY KEY REFERENCES export_cases(id) ON DELETE CASCADE,
  legal_name TEXT NOT NULL,
  trade_name TEXT,
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  address_line1 TEXT,
  city TEXT,
  country_code TEXT,
  captured_at TEXT NOT NULL
);

CREATE TABLE export_invoices (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES export_cases(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL,
  invoice_date TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  port_of_loading TEXT,
  port_of_discharge TEXT,
  destination_country TEXT,
  payment_term_code TEXT NOT NULL REFERENCES payment_term_types(code),
  payment_term_details TEXT,
  due_days INTEGER,
  due_date TEXT,
  incoterm TEXT NOT NULL CHECK (incoterm IN ('FOB', 'CFR')),
  incoterms_edition TEXT NOT NULL,
  named_place TEXT,
  currency TEXT NOT NULL,
  currency_decimals INTEGER NOT NULL DEFAULT 2,
  goods_value_minor INTEGER NOT NULL CHECK (goods_value_minor >= 0),
  invoiced_freight_minor INTEGER NOT NULL CHECK (invoiced_freight_minor >= 0),
  actual_freight_expense_minor INTEGER NOT NULL CHECK (actual_freight_expense_minor >= 0),
  invoice_total_minor INTEGER NOT NULL CHECK (invoice_total_minor >= 0),
  gross_weight_grams INTEGER NOT NULL CHECK (gross_weight_grams >= 0),
  net_weight_grams INTEGER NOT NULL CHECK (net_weight_grams >= 0),
  units INTEGER,
  notes TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (gross_weight_grams >= net_weight_grams)
);
CREATE UNIQUE INDEX export_invoices_number_active_idx ON export_invoices(invoice_number);
CREATE INDEX export_invoices_case_idx ON export_invoices(case_id);

CREATE TABLE custom_field_definitions (
  id TEXT PRIMARY KEY,
  target_entity TEXT NOT NULL,
  field_key TEXT NOT NULL,
  label_en TEXT NOT NULL,
  label_ar TEXT NOT NULL,
  data_type TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 0,
  options_json TEXT,
  sensitive INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (target_entity, field_key)
);

CREATE TABLE custom_field_values (
  id TEXT PRIMARY KEY,
  definition_id TEXT NOT NULL REFERENCES custom_field_definitions(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  value_text TEXT,
  UNIQUE (definition_id, entity_id)
);

CREATE TABLE document_type_definitions (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name_en TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE document_template_sets (
  id TEXT PRIMARY KEY,
  name_en TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE document_template_items (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES document_template_sets(id) ON DELETE CASCADE,
  document_type_id TEXT NOT NULL REFERENCES document_type_definitions(id),
  required INTEGER NOT NULL DEFAULT 1,
  UNIQUE (template_id, document_type_id)
);

CREATE TABLE operation_document_requirements (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES export_cases(id) ON DELETE CASCADE,
  document_type_id TEXT NOT NULL REFERENCES document_type_definitions(id),
  required INTEGER NOT NULL DEFAULT 1,
  due_date TEXT,
  status TEXT NOT NULL,
  owner_user_id TEXT REFERENCES user(id),
  waived_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX operation_docs_case_idx ON operation_document_requirements(case_id, status);

CREATE TABLE document_versions (
  id TEXT PRIMARY KEY,
  requirement_id TEXT NOT NULL REFERENCES operation_document_requirements(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  original_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  checksum TEXT,
  uploaded_by TEXT REFERENCES user(id),
  review_state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (requirement_id, version)
);

CREATE TABLE document_reviews (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
  reviewer_id TEXT REFERENCES user(id),
  decision TEXT NOT NULL,
  comment TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE physical_original_events (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES export_cases(id) ON DELETE CASCADE,
  requirement_id TEXT REFERENCES operation_document_requirements(id),
  event_type TEXT NOT NULL,
  actor_id TEXT REFERENCES user(id),
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE bank_submissions (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES export_cases(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL,
  bank_name TEXT,
  status TEXT NOT NULL,
  received_at TEXT,
  handed_over_at TEXT,
  handed_over_by TEXT REFERENCES user(id),
  review_decision TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE bank_events (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES bank_submissions(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  reason TEXT,
  actor_id TEXT REFERENCES user(id),
  created_at TEXT NOT NULL
);

CREATE TABLE courier_shipments (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES export_cases(id) ON DELETE CASCADE,
  route TEXT NOT NULL,
  sender TEXT NOT NULL CHECK (sender IN ('COMPANY', 'BANK')),
  carrier TEXT NOT NULL,
  tracking_number TEXT,
  recipient_summary TEXT,
  status TEXT NOT NULL,
  sent_at TEXT,
  expected_at TEXT,
  delivered_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX courier_case_idx ON courier_shipments(case_id);

CREATE TABLE courier_tracking_events (
  id TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL REFERENCES courier_shipments(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  note TEXT,
  event_at TEXT NOT NULL,
  actor_id TEXT REFERENCES user(id),
  source TEXT NOT NULL DEFAULT 'MANUAL',
  created_at TEXT NOT NULL
);

CREATE TABLE bookings (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES export_cases(id) ON DELETE CASCADE,
  booking_number TEXT NOT NULL,
  ucr TEXT,
  shipping_line TEXT,
  vessel TEXT,
  voyage TEXT,
  port_of_loading TEXT,
  port_of_discharge TEXT,
  expected_containers INTEGER NOT NULL DEFAULT 0 CHECK (expected_containers >= 0),
  status TEXT NOT NULL,
  planned_loading_date TEXT,
  actual_loading_date TEXT,
  cutoff_date TEXT,
  planned_etd TEXT,
  actual_etd TEXT,
  planned_eta TEXT,
  actual_eta TEXT,
  notes TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX bookings_number_idx ON bookings(booking_number) WHERE status != 'CANCELLED';
CREATE INDEX bookings_case_idx ON bookings(case_id);
CREATE INDEX bookings_schedule_idx ON bookings(planned_etd, planned_eta, planned_loading_date);

CREATE TABLE booking_attachments (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  document_version_id TEXT REFERENCES document_versions(id),
  r2_key TEXT NOT NULL,
  original_name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'BOOKING_CONFIRMATION',
  created_at TEXT NOT NULL
);

CREATE TABLE containers (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  case_id TEXT NOT NULL REFERENCES export_cases(id) ON DELETE CASCADE,
  slot_index INTEGER NOT NULL,
  official_number TEXT,
  official_number_override INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  weight_grams INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (booking_id, slot_index)
);
CREATE UNIQUE INDEX containers_official_number_idx
  ON containers(official_number)
  WHERE official_number IS NOT NULL AND status != 'CANCELLED';
CREATE INDEX containers_case_idx ON containers(case_id, status);

CREATE TABLE container_events (
  id TEXT PRIMARY KEY,
  container_id TEXT NOT NULL REFERENCES containers(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  event_at TEXT NOT NULL,
  is_actual INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  actor_id TEXT REFERENCES user(id),
  created_at TEXT NOT NULL
);

CREATE TABLE reminder_rule_definitions (
  id TEXT PRIMARY KEY,
  family TEXT NOT NULL,
  name_en TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  scope TEXT NOT NULL DEFAULT 'COMPANY',
  offset_amount INTEGER NOT NULL,
  offset_direction TEXT NOT NULL,
  offset_unit TEXT NOT NULL,
  day_policy TEXT NOT NULL DEFAULT 'CALENDAR',
  condition_key TEXT NOT NULL,
  repeat_every_days INTEGER,
  repeat_cap INTEGER,
  recipient TEXT NOT NULL DEFAULT 'ASSIGNEE',
  priority TEXT NOT NULL DEFAULT 'NORMAL',
  mandatory INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE reminder_instances (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES reminder_rule_definitions(id),
  case_id TEXT NOT NULL REFERENCES export_cases(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  condition_key TEXT NOT NULL,
  generation INTEGER NOT NULL DEFAULT 1,
  due_at TEXT NOT NULL,
  status TEXT NOT NULL,
  snoozed_until TEXT,
  resolved_at TEXT,
  last_evaluated_at TEXT,
  dedup_key TEXT NOT NULL UNIQUE,
  owner_user_id TEXT REFERENCES user(id),
  reason TEXT,
  next_action TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX reminder_due_idx ON reminder_instances(status, due_at);

CREATE TABLE notification_deliveries (
  id TEXT PRIMARY KEY,
  reminder_id TEXT NOT NULL REFERENCES reminder_instances(id) ON DELETE CASCADE,
  cycle_key TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'IN_APP',
  created_at TEXT NOT NULL,
  UNIQUE (reminder_id, cycle_key)
);

CREATE TABLE notification_reads (
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  delivery_id TEXT NOT NULL REFERENCES notification_deliveries(id) ON DELETE CASCADE,
  read_at TEXT NOT NULL,
  PRIMARY KEY (user_id, delivery_id)
);

CREATE TABLE customer_tracking_links (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES export_cases(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_by TEXT REFERENCES user(id),
  expires_at TEXT,
  revoked_at TEXT,
  display_scope_json TEXT NOT NULL,
  last_accessed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE tracking_link_access_events (
  id TEXT PRIMARY KEY,
  link_id TEXT NOT NULL REFERENCES customer_tracking_links(id) ON DELETE CASCADE,
  accessed_at TEXT NOT NULL,
  ip_hash TEXT,
  user_agent TEXT
);

CREATE TABLE upload_sessions (
  id TEXT PRIMARY KEY,
  object_key TEXT NOT NULL,
  parent_type TEXT NOT NULL,
  parent_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES user(id),
  filename TEXT NOT NULL,
  expected_bytes INTEGER NOT NULL,
  mime TEXT NOT NULL,
  upload_id TEXT,
  state TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  finalized_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE upload_parts (
  session_id TEXT NOT NULL REFERENCES upload_sessions(id) ON DELETE CASCADE,
  part_number INTEGER NOT NULL,
  etag TEXT,
  size_bytes INTEGER,
  PRIMARY KEY (session_id, part_number)
);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  reason TEXT,
  origin TEXT NOT NULL DEFAULT 'API',
  request_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX audit_entity_idx ON audit_log(entity_type, entity_id, created_at);
CREATE INDEX audit_created_idx ON audit_log(created_at);

CREATE TABLE case_events (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES export_cases(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  actor_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX case_events_idx ON case_events(case_id, created_at);

CREATE TABLE import_jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  filename TEXT,
  created_by TEXT REFERENCES user(id),
  summary_json TEXT,
  created_at TEXT NOT NULL,
  committed_at TEXT
);

CREATE TABLE login_attempts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  ip TEXT,
  success INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX login_attempts_idx ON login_attempts(email, created_at);
