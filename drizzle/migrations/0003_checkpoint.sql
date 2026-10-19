ALTER TABLE company_settings ADD COLUMN bootstrap_consumed INTEGER NOT NULL DEFAULT 0;
UPDATE company_settings SET bootstrap_consumed = 1 WHERE EXISTS (SELECT 1 FROM user);

ALTER TABLE customers ADD COLUMN tax_id TEXT;

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  bucket_key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  hits INTEGER NOT NULL
);
