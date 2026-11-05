ALTER TABLE customers ADD COLUMN customer_code TEXT;
CREATE UNIQUE INDEX customers_code_idx ON customers(customer_code)
  WHERE customer_code IS NOT NULL AND archived_at IS NULL;
