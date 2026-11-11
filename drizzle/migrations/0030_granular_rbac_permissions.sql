-- 0030 — Granular RBAC permissions (59 total permissions: +14 fine-grained keys)
-- Idempotent and additive: inserts the 14 new permission keys into `permissions`
-- and seeds default grants in `role_permissions` for the four built-in roles.

PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO permissions (key, description) VALUES
  ('proformas.view', 'View proforma invoices and download proforma PDFs'),
  ('proformas.edit', 'Create, edit, and convert draft proforma invoices'),
  ('proformas.issue', 'Issue proforma invoices and store official PDF snapshots'),
  ('proformas.delete', 'Delete draft proforma invoices'),
  ('invoices.issue', 'Final issue of commercial invoices and packing lists'),
  ('packing.edit', 'Edit packing list lines, assign containers, and sync totals'),
  ('packing.weights_override', 'Override calculated component weights with manual weighbridge totals'),
  ('trade.stamp.apply', 'Place, move, scale, and rotate the company stamp on trade documents'),
  ('trade.stamp.manage', 'Upload a new company stamp image or generate stamp templates'),
  ('catalog.products.manage', 'Create, update, and delete product presets and standard weights'),
  ('catalog.shipping.manage', 'Create, edit, and delete shipping methods and freight rules'),
  ('exporter.bank_accounts.manage', 'Create and edit exporter company bank accounts'),
  ('documents.restore_version', 'Restore a previously archived document version'),
  ('customer_files.manage', 'Publish or unpublish files on customer portal and reopen revisions');

-- 1. administrator: all 14 new permissions
INSERT OR IGNORE INTO role_permissions (role_id, permission_key)
SELECT r.id, p.key
  FROM roles r
  JOIN permissions p ON p.key IN (
    'proformas.view',
    'proformas.edit',
    'proformas.issue',
    'proformas.delete',
    'invoices.issue',
    'packing.edit',
    'packing.weights_override',
    'trade.stamp.apply',
    'trade.stamp.manage',
    'catalog.products.manage',
    'catalog.shipping.manage',
    'exporter.bank_accounts.manage',
    'documents.restore_version',
    'customer_files.manage'
  )
 WHERE r.key = 'administrator';

-- 2. operations_manager: 13 new permissions (all except exporter.bank_accounts.manage)
INSERT OR IGNORE INTO role_permissions (role_id, permission_key)
SELECT r.id, p.key
  FROM roles r
  JOIN permissions p ON p.key IN (
    'proformas.view',
    'proformas.edit',
    'proformas.issue',
    'proformas.delete',
    'invoices.issue',
    'packing.edit',
    'packing.weights_override',
    'trade.stamp.apply',
    'trade.stamp.manage',
    'catalog.products.manage',
    'catalog.shipping.manage',
    'documents.restore_version',
    'customer_files.manage'
  )
 WHERE r.key = 'operations_manager';

-- 3. export_officer: 9 operational permissions
INSERT OR IGNORE INTO role_permissions (role_id, permission_key)
SELECT r.id, p.key
  FROM roles r
  JOIN permissions p ON p.key IN (
    'proformas.view',
    'proformas.edit',
    'proformas.issue',
    'invoices.issue',
    'packing.edit',
    'packing.weights_override',
    'trade.stamp.apply',
    'catalog.products.manage',
    'customer_files.manage'
  )
 WHERE r.key = 'export_officer';

-- 4. viewer: proformas.view
INSERT OR IGNORE INTO role_permissions (role_id, permission_key)
SELECT r.id, 'proformas.view'
  FROM roles r
 WHERE r.key = 'viewer';

