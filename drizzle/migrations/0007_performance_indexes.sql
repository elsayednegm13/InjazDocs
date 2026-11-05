-- Indexes for the lookup paths that SQLite does not cover automatically.
-- SQLite does not create an index for a foreign key column, so every read of a
-- child table by its parent was a full table scan.
CREATE INDEX IF NOT EXISTS export_cases_customer_idx ON export_cases(customer_id, created_at);
CREATE INDEX IF NOT EXISTS customer_contacts_customer_idx ON customer_contacts(customer_id);
CREATE INDEX IF NOT EXISTS customer_addresses_customer_idx ON customer_addresses(customer_id);
CREATE INDEX IF NOT EXISTS customer_bank_accounts_customer_idx ON customer_bank_accounts(customer_id);
CREATE INDEX IF NOT EXISTS reminder_instances_case_idx ON reminder_instances(case_id);
CREATE INDEX IF NOT EXISTS upload_sessions_parent_idx ON upload_sessions(parent_type, parent_id);
