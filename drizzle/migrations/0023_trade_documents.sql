-- Trade documents: exporter print identity, proforma beside quotations,
-- commercial invoice lines, and a separate packing list.
-- export_invoices stays one row per case. quotations stay free of bank data.

PRAGMA foreign_keys = ON;

CREATE TABLE exporter_identity (
  id TEXT PRIMARY KEY,
  name_en TEXT NOT NULL DEFAULT '',
  name_ar TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  tax_card TEXT,
  tax_file TEXT,
  commercial_registry TEXT,
  phone TEXT,
  email TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE exporter_bank_accounts (
  id TEXT PRIMARY KEY,
  account_name TEXT NOT NULL,
  iban TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  bank_address TEXT,
  swift_code TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE exporter_marks (
  id TEXT PRIMARY KEY,
  logo_r2_key TEXT,
  stamp_r2_key TEXT,
  stamp_label_en TEXT,
  stamp_label_ar TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE product_presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description_template TEXT NOT NULL DEFAULT '',
  ply TEXT,
  material TEXT,
  size_label TEXT,
  barcode TEXT,
  hs_code TEXT,
  unit_label TEXT,
  default_price_minor INTEGER NOT NULL DEFAULT 0 CHECK (default_price_minor >= 0),
  default_packing_per_package INTEGER CHECK (default_packing_per_package IS NULL OR default_packing_per_package >= 0),
  piece_weight_grams INTEGER CHECK (piece_weight_grams IS NULL OR piece_weight_grams >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE proforma_invoices (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  case_id TEXT REFERENCES export_cases(id),
  invoice_number TEXT NOT NULL,
  print_reference TEXT,
  invoice_date TEXT NOT NULL,
  origin_of_goods TEXT NOT NULL DEFAULT 'EGYPT',
  port_of_loading TEXT,
  port_of_discharge TEXT,
  payment_term_code TEXT NOT NULL REFERENCES payment_term_types(code),
  payment_term_label TEXT,
  incoterm TEXT NOT NULL CHECK (incoterm IN ('FOB', 'CFR')),
  shipping_method_label TEXT,
  exporter_bank_account_id TEXT REFERENCES exporter_bank_accounts(id),
  currency TEXT NOT NULL DEFAULT 'USD',
  currency_decimals INTEGER NOT NULL DEFAULT 2,
  fob_total_minor INTEGER NOT NULL DEFAULT 0 CHECK (fob_total_minor >= 0),
  sea_freight_minor INTEGER NOT NULL DEFAULT 0 CHECK (sea_freight_minor >= 0),
  total_minor INTEGER NOT NULL DEFAULT 0 CHECK (total_minor >= 0),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ISSUED')),
  converted_invoice_id TEXT REFERENCES export_invoices(id),
  issued_snapshot_json TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX proforma_invoices_number_idx ON proforma_invoices(invoice_number);
CREATE INDEX proforma_invoices_case_idx ON proforma_invoices(case_id);

CREATE TABLE proforma_lines (
  id TEXT PRIMARY KEY,
  proforma_id TEXT NOT NULL REFERENCES proforma_invoices(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL CHECK (line_no >= 1),
  description TEXT NOT NULL,
  unit_label TEXT,
  quantity INTEGER NOT NULL CHECK (quantity >= 0),
  unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
  line_total_minor INTEGER NOT NULL CHECK (line_total_minor >= 0),
  UNIQUE (proforma_id, line_no)
);

ALTER TABLE export_invoices ADD COLUMN packages_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE export_invoices ADD COLUMN payment_term_label TEXT;
ALTER TABLE export_invoices ADD COLUMN shipping_method_label TEXT;
ALTER TABLE export_invoices ADD COLUMN origin_of_goods TEXT;
ALTER TABLE export_invoices ADD COLUMN exporter_bank_account_id TEXT REFERENCES exporter_bank_accounts(id);
ALTER TABLE export_invoices ADD COLUMN trade_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE export_invoices ADD COLUMN trade_status TEXT NOT NULL DEFAULT 'DRAFT';

CREATE TABLE invoice_lines (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES export_invoices(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL CHECK (line_no >= 1),
  description TEXT NOT NULL,
  hs_code TEXT,
  barcode TEXT,
  unit_label TEXT,
  quantity INTEGER NOT NULL CHECK (quantity >= 0),
  unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
  line_total_minor INTEGER NOT NULL CHECK (line_total_minor >= 0),
  UNIQUE (invoice_id, line_no)
);

CREATE TABLE packing_lines (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES export_invoices(id) ON DELETE CASCADE,
  case_id TEXT NOT NULL REFERENCES export_cases(id),
  container_id TEXT REFERENCES containers(id),
  line_no INTEGER NOT NULL CHECK (line_no >= 1),
  description TEXT NOT NULL,
  hs_code TEXT,
  barcode TEXT,
  packages_count INTEGER NOT NULL CHECK (packages_count >= 0),
  packing_per_package INTEGER NOT NULL CHECK (packing_per_package >= 0),
  pieces_count INTEGER NOT NULL CHECK (pieces_count >= 0),
  gross_weight_grams INTEGER NOT NULL CHECK (gross_weight_grams >= 0),
  net_weight_grams INTEGER NOT NULL CHECK (net_weight_grams >= 0),
  UNIQUE (invoice_id, line_no),
  CHECK (net_weight_grams <= gross_weight_grams),
  CHECK (pieces_count = packages_count * packing_per_package)
);

CREATE INDEX packing_lines_case_idx ON packing_lines(case_id);
