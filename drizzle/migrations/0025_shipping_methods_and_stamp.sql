CREATE TABLE shipping_methods (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  includes_freight INTEGER NOT NULL DEFAULT 0 CHECK (includes_freight IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX shipping_methods_code_idx ON shipping_methods(code);

ALTER TABLE proforma_invoices ADD COLUMN is_stamped INTEGER NOT NULL DEFAULT 0;
ALTER TABLE proforma_invoices ADD COLUMN stamp_x REAL;
ALTER TABLE proforma_invoices ADD COLUMN stamp_y REAL;
ALTER TABLE proforma_invoices ADD COLUMN stamp_rotation REAL;

ALTER TABLE export_invoices ADD COLUMN is_stamped INTEGER NOT NULL DEFAULT 0;
ALTER TABLE export_invoices ADD COLUMN stamp_x REAL;
ALTER TABLE export_invoices ADD COLUMN stamp_y REAL;
ALTER TABLE export_invoices ADD COLUMN stamp_rotation REAL;
