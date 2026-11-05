ALTER TABLE company_settings ADD COLUMN product_name TEXT NOT NULL DEFAULT 'ExportFlow';
ALTER TABLE company_settings ADD COLUMN theme TEXT NOT NULL DEFAULT 'light';
ALTER TABLE company_settings ADD COLUMN favicon_mime TEXT;
ALTER TABLE company_settings ADD COLUMN favicon_data BLOB;
