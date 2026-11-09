import { normalizePage } from "../../shared/api";
import { all, newId, nowIso, one } from "../db/sql";
import { errors } from "../http/errors";
import type { Actor } from "./actor";
import { caseVisibilitySql, requirePermission } from "./actor";
import { writeAudit, auditInsert } from "./audit";
import { planCustomFieldWrites, readCustomFields, saveCustomFields } from "./custom-fields";
import { assertSchemaReady } from "./schema";

export async function listCustomers(
  db: D1Database,
  query: { page?: number; pageSize?: number; q?: string },
) {
  const page = normalizePage(query.page, query.pageSize);
  const like = query.q ? `%${query.q}%` : null;
  const where = like ? "WHERE archived_at IS NULL AND (legal_name LIKE ? OR trade_name LIKE ? OR customer_code LIKE ?)" : "WHERE archived_at IS NULL";
  const binds = like ? [like, like, like] : [];
  const total = await one<{ n: number }>(db, `SELECT COUNT(*) AS n FROM customers ${where}`, ...binds);
  const rows = await all(
    db,
    `SELECT id, legal_name, trade_name, customer_code, country_code, updated_at
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
    await assertSchemaReady(db, "customers");
    banks = await all(
      db,
      "SELECT id, bank_name, account_name, account_number, account_number_last4, iban, iban_last4, swift, created_at FROM customer_bank_accounts WHERE customer_id = ?",
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
    customerCode?: string;
    contacts?: { fullName: string; title?: string; email?: string; phone?: string; isPrimary?: boolean }[];
    addresses?: { kind: "BILLING" | "SHIPPING" | "OTHER"; line1: string; line2?: string; city?: string; region?: string; postalCode?: string; countryCode?: string; isPrimary?: boolean }[];
    banks?: { bankName: string; accountName?: string; accountNumber?: string; iban?: string; swift?: string }[];
    customFields?: Record<string, unknown>;
  },
  requestId: string,
  options?: { id?: string },
) {
  requirePermission(actor, "customers.create");
  if (!input.legalName?.trim()) throw errors.validation("Legal name is required");
  if (input.legalName.trim().length > 200) {
    throw errors.validation("Legal name is too long", { legalName: "Use 200 characters or fewer." }, "CUSTOMER_NAME_TOO_LONG");
  }
  // Check the sensitive-bank permission before writing the customer so a
  // denied bank block cannot leave a partially created record behind.
  if (input.banks?.length) {
    requirePermission(actor, "customers.bank_details.edit");
    await assertSchemaReady(db, "customers");
  }
  // Bound the number of child rows so one request cannot build an oversized
  // transaction or exceed the D1 batch limit.
  if ((input.contacts?.length ?? 0) > 20) throw errors.validation("Too many contacts", { contactName: "Use 20 contacts or fewer." }, "CUSTOMER_CONTACTS_LIMIT");
  if ((input.addresses?.length ?? 0) > 20) throw errors.validation("Too many addresses", { line1: "Use 20 addresses or fewer." }, "CUSTOMER_ADDRESSES_LIMIT");
  if ((input.banks?.length ?? 0) > 10) throw errors.validation("Too many bank accounts", { bankName: "Use 10 bank accounts or fewer." }, "CUSTOMER_BANKS_LIMIT");
  // Import callers pass a deterministic id derived from (importId, rowIndex)
  // so a retry after a commit-before-row-record crash hits the primary key
  // instead of creating a second customer.
  const id = options?.id ?? newId();
  const now = nowIso();
  const customerCode = normalizeCustomerCode(input.customerCode, null);
  if (customerCode) await assertCustomerCodeAvailable(db, customerCode);
  // The customer, its contacts, addresses, bank accounts, custom field values
  // and the audit row are written in one D1 batch: either the whole record
  // exists or nothing was written at all.
  const fieldPlan = await planCustomFieldWrites(db, actor, "CUSTOMER", id, input.customFields, { enforceRequired: true });
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO customers (id, legal_name, trade_name, country_code, notes, tax_id, customer_code, version, created_at, updated_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      )
      .bind(id, input.legalName.trim(), input.tradeName ?? null, input.countryCode ?? null, input.notes ?? null, input.taxId ?? null, customerCode, now, now, actor.id),
  ];
  for (const contact of input.contacts ?? []) {
    statements.push(
      db
        .prepare(
          `INSERT INTO customer_contacts (id, customer_id, full_name, title, email, phone, is_primary)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(newId(), id, contact.fullName, contact.title ?? null, contact.email ?? null, contact.phone ?? null, contact.isPrimary ? 1 : 0),
    );
  }
  for (const address of input.addresses ?? []) {
    statements.push(
      db
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
        ),
    );
  }
  for (const bank of input.banks ?? []) {
    statements.push(
      db
        .prepare(
          `INSERT INTO customer_bank_accounts (id, customer_id, bank_name, account_name, account_number, account_number_last4, iban, iban_last4, swift, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          newId(),
          id,
          bank.bankName,
          bank.accountName ?? null,
          bank.accountNumber ?? null,
          last4(bank.accountNumber),
          bank.iban ?? null,
          last4(bank.iban),
          bank.swift ?? null,
          now,
        ),
    );
  }
  statements.push(...fieldPlan.statements);
  statements.push(
    auditInsert(db, {
      actorId: actor.id,
      entityType: "customer",
      entityId: id,
      action: "customer.create",
      after: { legalName: input.legalName },
      requestId,
    }),
  );
  try {
    await db.batch(statements);
  } catch (error) {
    if (!isMissingCustomerCode(error)) throw error;
    // A store that passed the 0008 readiness gate may still predate migration 0016.
    statements[0] = db
      .prepare(
        `INSERT INTO customers (id, legal_name, trade_name, country_code, notes, tax_id, version, created_at, updated_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      )
      .bind(id, input.legalName.trim(), input.tradeName ?? null, input.countryCode ?? null, input.notes ?? null, input.taxId ?? null, now, now, actor.id);
    await db.batch(statements);
  }
  return { id };
}

export async function updateCustomer(
  db: D1Database,
  actor: Actor,
  id: string,
  input: {
    legalName?: string;
    tradeName?: string;
    countryCode?: string;
    notes?: string;
    taxId?: string;
    customerCode?: string;
    contacts?: ContactInput[];
    addresses?: AddressInput[];
    banks?: BankInput[];
    version: number;
    customFields?: Record<string, unknown>;
  },
  requestId: string,
) {
  requirePermission(actor, "customers.edit");
  const existing = await one<{
    version: number;
    legal_name: string;
    trade_name: string | null;
    country_code: string | null;
    notes: string | null;
    tax_id: string | null;
    customer_code: string | null;
  }>(db, "SELECT version, legal_name, trade_name, country_code, notes, tax_id, customer_code FROM customers WHERE id = ?", id);
  if (!existing) throw errors.notFound("Customer not found");
  if (Number(existing.version) !== Number(input.version)) throw errors.conflict("Customer was updated by someone else");
  const legalName = input.legalName === undefined ? existing.legal_name : input.legalName.trim();
  if (!legalName) throw errors.validation("Legal name is required", { legalName: "Enter the legal name." });
  if (legalName.length > 200) {
    throw errors.validation("Legal name is too long", { legalName: "Use 200 characters or fewer." }, "CUSTOMER_NAME_TOO_LONG");
  }
  const customerCode = normalizeCustomerCode(input.customerCode, existing.customer_code);
  if (customerCode) await assertCustomerCodeAvailable(db, customerCode, id);
  const contacts = input.contacts === undefined ? undefined : normalizeContacts(input.contacts);
  const addresses = input.addresses === undefined ? undefined : normalizeAddresses(input.addresses);
  const banks = input.banks === undefined ? undefined : normalizeBanks(input.banks);
  if (banks) {
    requirePermission(actor, "customers.bank_details.edit");
    await assertSchemaReady(db, "customers");
  }
  const storedBanks = banks
    ? await all<{ id: string; account_number: string | null; account_number_last4: string | null; iban: string | null; iban_last4: string | null; restricted_notes: string | null }>(
        db,
        "SELECT id, account_number, account_number_last4, iban, iban_last4, restricted_notes FROM customer_bank_accounts WHERE customer_id = ?",
        id,
      )
    : [];
  const storedById = new Map(storedBanks.map((bank) => [bank.id, bank]));
  const version = existing.version;
  const statements: D1PreparedStatement[] = [];
  if (contacts) {
    statements.push(
      db
        .prepare(
          `DELETE FROM customer_contacts WHERE customer_id = ? AND EXISTS (SELECT 1 FROM customers WHERE id = ? AND version = ?)`,
        )
        .bind(id, id, version),
    );
    for (const contact of contacts) {
      statements.push(
        db
          .prepare(
            `INSERT INTO customer_contacts (id, customer_id, full_name, title, email, phone, is_primary)
             SELECT ?, ?, ?, ?, ?, ?, ?
             WHERE EXISTS (SELECT 1 FROM customers WHERE id = ? AND version = ?)`,
          )
          .bind(newId(), id, contact.fullName, contact.title, contact.email, contact.phone, contact.isPrimary ? 1 : 0, id, version),
      );
    }
  }
  if (addresses) {
    statements.push(
      db
        .prepare(
          `DELETE FROM customer_addresses WHERE customer_id = ? AND EXISTS (SELECT 1 FROM customers WHERE id = ? AND version = ?)`,
        )
        .bind(id, id, version),
    );
    for (const address of addresses) {
      statements.push(
        db
          .prepare(
            `INSERT INTO customer_addresses (id, customer_id, kind, line1, line2, city, region, postal_code, country_code, is_primary)
             SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
             WHERE EXISTS (SELECT 1 FROM customers WHERE id = ? AND version = ?)`,
          )
          .bind(
            newId(),
            id,
            address.kind,
            address.line1,
            address.line2,
            address.city,
            address.region,
            address.postalCode,
            address.countryCode,
            address.isPrimary ? 1 : 0,
            id,
            version,
          ),
      );
    }
  }
  if (banks) {
    statements.push(
      db
        .prepare(
          `DELETE FROM customer_bank_accounts WHERE customer_id = ? AND EXISTS (SELECT 1 FROM customers WHERE id = ? AND version = ?)`,
        )
        .bind(id, id, version),
    );
    for (const bank of banks) {
      const prior = bank.id ? storedById.get(bank.id) : undefined;
      statements.push(
        db
          .prepare(
            `INSERT INTO customer_bank_accounts (id, customer_id, bank_name, account_name, account_number, account_number_last4, iban, iban_last4, swift, restricted_notes, created_at)
             SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
             WHERE EXISTS (SELECT 1 FROM customers WHERE id = ? AND version = ?)`,
          )
          .bind(
            newId(),
            id,
            bank.bankName,
            bank.accountName,
            bank.accountNumber || prior?.account_number || prior?.account_number_last4 || null,
            bank.accountNumber ? last4(bank.accountNumber) : prior?.account_number_last4 ?? null,
            bank.iban || prior?.iban || prior?.iban_last4 || null,
            bank.iban ? last4(bank.iban) : prior?.iban_last4 ?? null,
            bank.swift,
            prior?.restricted_notes ?? null,
            nowIso(),
            id,
            version,
          ),
      );
    }
  }
  statements.push(
    db
      .prepare(
        `UPDATE customers SET legal_name = ?, trade_name = ?, country_code = ?, notes = ?, tax_id = ?, customer_code = ?, version = version + 1, updated_at = ?
         WHERE id = ? AND version = ?`,
      )
      .bind(
        legalName,
        optionalText(input.tradeName, existing.trade_name),
        optionalText(input.countryCode, existing.country_code),
        optionalText(input.notes, existing.notes),
        optionalText(input.taxId, existing.tax_id),
        customerCode,
        nowIso(),
        id,
        input.version,
      ),
  );
  const results = await db.batch(statements);
  const updated = results.at(-1);
  if (!updated?.meta.changes) throw errors.conflict("Customer was updated by someone else");
  await saveCustomFields(db, actor, "CUSTOMER", id, input.customFields, { enforceRequired: true, requestId });
  await writeAudit(db, {
    actorId: actor.id,
    entityType: "customer",
    entityId: id,
    action: "customer.update",
    after: { legalName, contacts: contacts?.length, addresses: addresses?.length, banks: banks?.length },
    requestId,
  });
}

type ContactInput = { fullName?: unknown; title?: unknown; email?: unknown; phone?: unknown; isPrimary?: unknown };
type AddressInput = {
  kind?: unknown;
  line1?: unknown;
  line2?: unknown;
  city?: unknown;
  region?: unknown;
  postalCode?: unknown;
  countryCode?: unknown;
  isPrimary?: unknown;
};
type BankInput = { id?: unknown; bankName?: unknown; accountName?: unknown; accountNumber?: unknown; iban?: unknown; swift?: unknown };

const ADDRESS_KINDS = new Set(["BILLING", "SHIPPING", "OTHER"]);

function boundedText(value: unknown, max: number, field: string): string {
  if (value == null) return "";
  if (typeof value !== "string") throw errors.validation("Enter text.", { [field]: "Enter text." });
  const trimmed = value.trim();
  if (trimmed.length > max) throw errors.validation("A field is too long", { [field]: `Use ${max} characters or fewer.` });
  return trimmed;
}

function compactCode(value: unknown, max: number, field: string): string {
  return boundedText(value, max, field).replace(/\s+/g, "");
}

function flag(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

function rowsOf<T>(value: T[] | undefined, limit: number, field: string): T[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw errors.validation("The list is invalid.", { [field]: "Send a list." });
  if (value.length > limit) throw errors.validation("Too many rows", { [field]: `Use ${limit} rows or fewer.` });
  return value;
}

function normalizeContacts(value: ContactInput[]) {
  const rows = rowsOf(value, 20, "contacts") ?? [];
  const cleaned = rows.map((row, index) => {
    const fullName = boundedText(row.fullName, 200, `contacts.${index}.fullName`);
    const email = boundedText(row.email, 200, `contacts.${index}.email`);
    if (!fullName) throw errors.validation("Contact name is required", { [`contacts.${index}.fullName`]: "Enter the contact name." });
    if (email && !/^[^\s@]+@[^\s@]+$/.test(email)) {
      throw errors.validation("Email is invalid", { [`contacts.${index}.email`]: "Enter a valid email." });
    }
    return {
      fullName,
      title: boundedText(row.title, 120, `contacts.${index}.title`) || null,
      email: email || null,
      phone: boundedText(row.phone, 40, `contacts.${index}.phone`) || null,
      isPrimary: flag(row.isPrimary),
    };
  });
  return onePrimary(cleaned);
}

function normalizeAddresses(value: AddressInput[]) {
  const rows = rowsOf(value, 20, "addresses") ?? [];
  const cleaned = rows.map((row, index) => {
    const kind = boundedText(row.kind, 20, `addresses.${index}.kind`);
    const line1 = boundedText(row.line1, 300, `addresses.${index}.line1`);
    if (!ADDRESS_KINDS.has(kind)) throw errors.validation("Address kind is invalid", { [`addresses.${index}.kind`]: "Choose a valid address kind." });
    if (!line1) throw errors.validation("Address line is required", { [`addresses.${index}.line1`]: "Enter the address." });
    return {
      kind: kind as "BILLING" | "SHIPPING" | "OTHER",
      line1,
      line2: boundedText(row.line2, 300, `addresses.${index}.line2`) || null,
      city: boundedText(row.city, 120, `addresses.${index}.city`) || null,
      region: boundedText(row.region, 120, `addresses.${index}.region`) || null,
      postalCode: boundedText(row.postalCode, 20, `addresses.${index}.postalCode`) || null,
      countryCode: boundedText(row.countryCode, 8, `addresses.${index}.countryCode`) || null,
      isPrimary: flag(row.isPrimary),
    };
  });
  return onePrimary(cleaned);
}

function normalizeBanks(value: BankInput[]) {
  const rows = rowsOf(value, 10, "banks") ?? [];
  return rows.map((row, index) => {
    const bankName = boundedText(row.bankName, 200, `banks.${index}.bankName`);
    if (!bankName) throw errors.validation("Bank name is required", { [`banks.${index}.bankName`]: "Enter the bank name." });
    return {
      id: typeof row.id === "string" && row.id.trim() ? row.id.trim() : undefined,
      bankName,
      accountName: boundedText(row.accountName, 200, `banks.${index}.accountName`) || null,
      accountNumber: compactCode(row.accountNumber, 64, `banks.${index}.accountNumber`),
      iban: compactCode(row.iban, 42, `banks.${index}.iban`),
      swift: compactCode(row.swift, 11, `banks.${index}.swift`) || null,
    };
  });
}

function onePrimary<T extends { isPrimary: boolean }>(rows: T[]): T[] {
  if (!rows.length) return rows;
  const chosen = Math.max(0, rows.findIndex((row) => row.isPrimary));
  return rows.map((row, index) => ({ ...row, isPrimary: index === chosen }));
}

function isMissingCustomerCode(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  return /customer_code/i.test(text) && /no (such )?column/i.test(text);
}

function normalizeCustomerCode(value: string | undefined | null, current: string | null): string | null {
  if (value == null) return current;
  const code = value.trim().toUpperCase();
  if (!code) return null;
  if (code.length > 40 || !/^[A-Z0-9][A-Z0-9\-_/]*$/.test(code)) {
    throw errors.validation(
      "Use a short customer code of letters, numbers, and dashes.",
      { customerCode: "Use letters, numbers, and dashes." },
      "CUSTOMER_CODE_INVALID",
    );
  }
  return code;
}

async function assertCustomerCodeAvailable(db: D1Database, code: string, exceptId?: string) {
  const taken = await one<{ id: string }>(
    db,
    "SELECT id FROM customers WHERE customer_code = ? AND archived_at IS NULL AND id != ?",
    code,
    exceptId ?? "",
  );
  if (taken) throw errors.conflict("This customer code is already used.", "CUSTOMER_CODE_TAKEN");
}

function optionalText(value: string | undefined, current: string | null): string | null {
  if (value === undefined) return current;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function last4(value?: string | null): string | null {
  if (!value) return null;
  const compact = value.replace(/\s+/g, "");
  return compact.slice(-4);
}
