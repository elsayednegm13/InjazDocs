-- 0009 — additive report entitlement (default deny).
--
-- `reports.view_all` widens the report ports (/reports/overview,
-- /reports/delays, /exports/csv) to every export case. It is deliberately NOT
-- derived from `export_cases.view_all`: operations staff keep their
-- operational view-all while the report scope stays least-privilege until the
-- owner grants this key per user or per role.
--
-- Additive only: two idempotent inserts. No table rebuild, no column change,
-- no data rewrite, and no grant to any role other than the built-in
-- administrator role, which mirrors ROLE_TEMPLATES.administrator = PERMISSIONS
-- in shared/permissions.ts. Re-applying this file changes nothing.
INSERT OR IGNORE INTO permissions (key, description)
VALUES (
  'reports.view_all',
  'View and export every export case in reports, regardless of assignment'
);

INSERT OR IGNORE INTO role_permissions (role_id, permission_key)
SELECT r.id, 'reports.view_all'
  FROM roles r
 WHERE r.key = 'administrator';
