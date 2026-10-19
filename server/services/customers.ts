import { normalizePage } from "../../shared/api";
import { all, newId, nowIso, one } from "../db/sql";
import { errors } from "../http/errors";
import type { Actor } from "./actor";
import { caseVisibilitySql, requirePermission } from "./actor";
import { writeAudit } from "./audit";
import { readCustomFields, saveCustomFields } from "./custom-fields";

export async function listCustomers(
  db: D1Database,
  query: { page?: number; pageSize?: number; q?: string },
) {
  const page = normalizePage(query.page, query.pageSize);
  const like = query.q ? `%${query.q}%` : null;
  const where = like ? "WHERE archived_at IS NULL AND (legal_name LIKE ? OR trade_name LIKE ?)" : "WHERE archived_at IS NULL";
  const binds = like ? [like, like] : [];
  const total = await one<{ n: number }>(db, `SELECT COUNT(*) AS n FROM customers ${where}`, ...binds);
  const rows = await all(
    db,
    `SELECT id, legal_name, trade_name, country_code, updated_at
     FROM customers ${where} ORDER BY legal_name LIMIT ? OFFSET ?`,
    ...binds,
    page.pageSize,
    page.offset,
  );
  return { rows, total: total?.n ?? 0, ...page };
}

export async function getCustomer(db: D1Database, actor: Actor, id: string) {
  const customer = await one(db, "SELECT * FROM customers WHERE id = ?", id);
  if (!customer) throw errors.notFound("Customer not found");
  const contacts = await all(db, "SELECT * FROM customer_contacts WHERE customer_id = ?", id);
  const addresses = await all(db, "SELECT * FROM customer_addresses WHERE customer_id = ?", id);
  let banks: unknown[] = [];
  if (actor.permissions.has("customers.bank_details.view")) {
    banks = await all(
      db,
      "SELECT id, bank_name, account_name, account_number_last4, iban_last4, swift, created_at FROM customer_bank_accounts WHERE customer_id = ?",
      id,
    );
  }
  const vis = caseVisibilitySql(actor);
  const cases = await all(
    db,
    `SELECT id, case_reference, status, destination_country, updated_at FROM export_cases c
     WHERE customer_id = ? AND ${vis.sql}
     ORDER BY created_at DESC LIMIT 50`,
    id,
    ...vis.binds,
  );
  return { customer, contacts, addresses, banks, cases, customFields: await readCustomFields(db, actor, "CUSTOMER", id) };
}

export async function createCustomer(
  db: D1Database,
  actor: Actor,
  input: {
    legalName: string;
    tradeName?: string;
    countryCode?: string;
    notes?: string;
    taxId?: string;
    contacts?: { fullName: string; title?: string; email?: string; phone?: string; isPrimary?: boolean }[];
    addresses?: { kind: "BILLING" | "SHIPPING" | "OTHER"; line1: string; line2?: string; city?: string; region?: string; postalCode?: string; countryCode?: string; isPrimary?: boolean }[];
    banks?: { bankName: string; accountName?: string; accountNumber?: string; iban?: string; swift?: string }[];
    customFields?: Record<string, unknown>;
  },
  requestId: string,
) {
  requirePermission(actor, "customers.create");
  if (!input.legalName?.trim()) throw errors.validation("Legal name is required");
  const id = newId();
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO customers (id, legal_name, trade_name, country_code, notes, tax_id, version, created_at, updated_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    )
    .bind(id, input.legalName.trim(), input.tradeName ?? null, input.countryCode ?? null, input.notes ?? null, input.taxId ?? null, now, now, actor.id)
    .run();
  for (const contact of input.contacts ?? []) {
    await db
      .prepare(
        `INSERT INTO customer_contacts (id, customer_id, full_name, title, email, phone, is_primary)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(newId(), id, contact.fullName, contact.title ?? null, contact.email ?? null, contact.phone ?? null, contact.isPrimary ? 1 : 0)
      .run();
  }
  for (const address of input.addresses ?? []) {
    await db
      .prepare(
        `INSERT INTO customer_addresses (id, customer_id, kind, line1, line2, city, region, postal_code, country_code, is_primary)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        newId(),
        id,
        address.kind,
        address.line1,
        address.line2 ?? null,
        address.city ?? null,
        address.region ?? null,
        address.postalCode ?? null,
        address.countryCode ?? null,
        address.isPrimary ? 1 : 0,
      )
      .run();
  }
  if (input.banks?.length) {
    requirePermission(actor, "customers.bank_details.edit");
    for (const bank of input.banks) {
      await db
        .prepare(
          `INSERT INTO customer_bank_accounts (id, customer_id, bank_name, account_name, account_number_last4, iban_last4, swift, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          newId(),
          id,
          bank.bankName,
          bank.accountName ?? null,
          last4(bank.accountNumber),
          last4(bank.iban),
          bank.swift ?? null,
          now,
        )
        .run();
    }
  }
  await saveCustomFields(db, actor, "CUSTOMER", id, input.customFields, { enforceRequired: true, requestId });
  await writeAudit(db, { actorId: actor.id, entityType: "customer", entityId: id, action: "customer.create", after: { legalName: input.legalName }, requestId });
  return { id };
}

export async function updateCustomer(
  db: D1Database,
  actor: Actor,
  id: string,
  input: { legalName?: string; tradeName?: string; countryCode?: string; notes?: string; version: number; customFields?: Record<string, unknown> },
  requestId: string,
) {
  requirePermission(actor, "customers.edit");
  const existing = await one<{ version: number; legal_name: string }>(db, "SELECT version, legal_name FROM customers WHERE id = ?", id);
  if (!existing) throw errors.notFound("Customer not found");
  if (existing.version !== input.version) throw errors.conflict("Customer was updated by someone else");
  await db
    .prepare(
      `UPDATE customers SET legal_name = ?, trade_name = ?, country_code = ?, notes = ?, version = version + 1, updated_at = ? WHERE id = ?`,
    )
    .bind(input.legalName ?? existing.legal_name, input.tradeName ?? null, input.countryCode ?? null, input.notes ?? null, nowIso(), id)
    .run();
  await saveCustomFields(db, actor, "CUSTOMER", id, input.customFields, { enforceRequired: true, requestId });
  await writeAudit(db, { actorId: actor.id, entityType: "customer", entityId: id, action: "customer.update", requestId });
}

function last4(value?: string | null): string | null {
  if (!value) return null;
  const compact = value.replace(/\s+/g, "");
  return compact.slice(-4);
}
