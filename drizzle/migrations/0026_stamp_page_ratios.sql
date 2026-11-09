ALTER TABLE proforma_invoices ADD COLUMN stamp_x_ratio REAL;
ALTER TABLE proforma_invoices ADD COLUMN stamp_y_ratio REAL;
ALTER TABLE proforma_invoices ADD COLUMN stamp_scale REAL;

ALTER TABLE export_invoices ADD COLUMN stamp_x_ratio REAL;
ALTER TABLE export_invoices ADD COLUMN stamp_y_ratio REAL;
ALTER TABLE export_invoices ADD COLUMN stamp_scale REAL;
ALTER TABLE export_invoices ADD COLUMN packing_is_stamped INTEGER NOT NULL DEFAULT 0;
ALTER TABLE export_invoices ADD COLUMN packing_stamp_x_ratio REAL;
ALTER TABLE export_invoices ADD COLUMN packing_stamp_y_ratio REAL;
ALTER TABLE export_invoices ADD COLUMN packing_stamp_scale REAL;
ALTER TABLE export_invoices ADD COLUMN packing_stamp_rotation REAL;
