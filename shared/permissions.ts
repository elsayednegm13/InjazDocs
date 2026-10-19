export const PERMISSIONS = [
  "dashboard.view",
  "customers.view",
  "customers.create",
  "customers.edit",
  "customers.bank_details.view",
  "customers.bank_details.edit",
  "export_cases.view_all",
  "export_cases.view_assigned",
  "export_cases.create",
  "export_cases.edit",
  "export_cases.close",
  "export_cases.reopen",
  "invoices.view",
  "invoices.edit",
  "invoices.correct_completed",
  "documents.view",
  "documents.upload",
  "documents.review",
  "documents.manage_types",
  "bank.view",
  "bank.manage",
  "courier.view",
  "courier.manage",
  "bookings.view",
  "bookings.manage",
  "containers.view",
  "containers.manage",
  "reminders.view",
  "reminders.manage_own",
  "reminders.manage_rules",
  "tracking_links.manage",
  "reports.view",
  "reports.export",
  "users.manage",
  "roles.manage",
  "settings.manage",
  "audit.view",
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number];

export const ROLE_TEMPLATES = {
  administrator: PERMISSIONS,
  operations_manager: [
    "dashboard.view",
    "customers.view",
    "customers.create",
    "customers.edit",
    "customers.bank_details.view",
    "export_cases.view_all",
    "export_cases.create",
    "export_cases.edit",
    "export_cases.close",
    "export_cases.reopen",
    "invoices.view",
    "invoices.edit",
    "documents.view",
    "documents.upload",
    "documents.review",
    "bank.view",
    "bank.manage",
    "courier.view",
    "courier.manage",
    "bookings.view",
    "bookings.manage",
    "containers.view",
    "containers.manage",
    "reminders.view",
    "reminders.manage_own",
    "tracking_links.manage",
    "reports.view",
    "reports.export",
    "audit.view",
  ] satisfies PermissionKey[],
  export_officer: [
    "dashboard.view",
    "customers.view",
    "customers.create",
    "customers.edit",
    "export_cases.view_assigned",
    "export_cases.create",
    "export_cases.edit",
    "invoices.view",
    "invoices.edit",
    "documents.view",
    "documents.upload",
    "courier.view",
    "courier.manage",
    "bookings.view",
    "bookings.manage",
    "containers.view",
    "containers.manage",
    "reminders.view",
    "reminders.manage_own",
    "tracking_links.manage",
  ] satisfies PermissionKey[],
  viewer: [
    "dashboard.view",
    "customers.view",
    "export_cases.view_assigned",
    "invoices.view",
    "documents.view",
    "courier.view",
    "bookings.view",
    "containers.view",
    "reminders.view",
    "reports.view",
  ] satisfies PermissionKey[],
} as const;

export type OverrideEffect = "GRANT" | "DENY";

export function resolveEffectivePermissions(input: {
  roleGrants: Iterable<string>;
  overrides: Iterable<{ permissionKey: string; effect: OverrideEffect }>;
}): Set<PermissionKey> {
  const granted = new Set<PermissionKey>();
  for (const key of input.roleGrants) {
    if ((PERMISSIONS as readonly string[]).includes(key)) {
      granted.add(key as PermissionKey);
    }
  }
  for (const override of input.overrides) {
    if (!(PERMISSIONS as readonly string[]).includes(override.permissionKey)) continue;
    const key = override.permissionKey as PermissionKey;
    if (override.effect === "DENY") granted.delete(key);
    if (override.effect === "GRANT") granted.add(key);
  }
  return granted;
}

export function hasPermission(
  effective: ReadonlySet<string>,
  key: PermissionKey,
): boolean {
  return effective.has(key);
}

export function canViewAllCases(effective: ReadonlySet<string>): boolean {
  return effective.has("export_cases.view_all");
}

export function canViewAssignedCases(effective: ReadonlySet<string>): boolean {
  return effective.has("export_cases.view_assigned") || canViewAllCases(effective);
}
