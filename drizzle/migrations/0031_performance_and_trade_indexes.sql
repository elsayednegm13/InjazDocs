-- Migration 0031: Performance & Trade Composite Indexes
-- Eliminates full-table scans on packing lines, proforma lookups, case filters,
-- custom field values, document reviews, and bank submissions.

CREATE INDEX IF NOT EXISTS packing_lines_invoice_idx ON packing_lines(invoice_id, line_no);
CREATE INDEX IF NOT EXISTS packing_lines_container_idx ON packing_lines(container_id);
CREATE INDEX IF NOT EXISTS proforma_invoices_customer_idx ON proforma_invoices(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS export_cases_assigned_status_idx ON export_cases(assigned_to, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS export_cases_status_updated_idx ON export_cases(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS custom_field_values_entity_idx ON custom_field_values(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS document_reviews_version_idx ON document_reviews(version_id);
CREATE INDEX IF NOT EXISTS bank_submissions_case_idx ON bank_submissions(case_id);

