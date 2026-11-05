-- A completed export case locks its invoices.
-- This flag is the temporary window a permitted user opens, edits inside, then closes.
ALTER TABLE export_invoices ADD COLUMN edit_open INTEGER NOT NULL DEFAULT 0;
