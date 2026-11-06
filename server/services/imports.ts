import { all, newId, nowIso, one } from "../db/sql";
import { errors, HttpError } from "../http/errors";
import type { Actor } from "./actor";
import { requirePermission } from "./actor";
import { createCustomer } from "./customers";
import { fingerprintCustomerImportRows } from "./import-fingerprint";
import { previewCustomerImport } from "./reports";

type ImportRowResult = {
  row: number;
  legalName: string;
  status: "IMPORTED" | "FAILED";
  customerId?: string;
  errorCode?: string;
  errorMessage?: string;
};

type ImportOperation = {
  id: string;
  status: string;
  total_rows: number;
  file_fingerprint: string | null;
  parser_version: string | null;
};

/**
 * Customer CSV import with a durable file identity, per-row outcome and resume.
 *
 * - The caller supplies `importId`. The first commit binds it immutably to the
 *   canonical parsed-file fingerprint. A retry with the same id and the same
 *   file continues the operation; a different file, header mapping or row
 *   order is rejected with 409 IMPORT_FILE_MISMATCH before any customer write.
 * - Legacy operations created before fingerprints existed fail closed. They
 *   are never bound to the first arbitrary file offered after the upgrade.
 * - Each row is written by `createCustomer` in one atomic D1 batch, so a row
 *   either exists completely or does not exist at all. A row that fails is
 *   recorded and the remaining rows continue, preserving per-row partial
 *   success rather than converting the file into an all-or-nothing write.
 * - Rows already IMPORTED under the same fingerprint are skipped on resume.
 */
export async function commitCustomerImport(
  db: D1Database,
  actor: Actor,
  input: { importId?: string; rows: Record<string, string>[] },
  requestId: string,
) {
  requirePermission(actor, "customers.create");
  const rows = Array.isArray(input?.rows) ? input.rows : [];
  if (!rows.length) throw errors.validation("The import file has no rows", { rows: "Choose a CSV file with at least one row." }, "IMPORT_EMPTY");
  const importId = String(input.importId ?? "").trim() || newId();
  if (importId.length > 120) throw errors.validation("The import id is too long", { importId: "Use 120 characters or fewer." }, "IMPORT_ID_TOO_LONG");

  const identity = await fingerprintCustomerImportRows(rows);
  const now = nowIso();

  let operation = await loadOperation(db, importId, actor.id);
  if (operation) {
    assertSameFile(operation, identity.fingerprint);
  } else {
    const taken = await one<{ actor_id: string }>(db, "SELECT actor_id FROM customer_import_operations WHERE id = ?", importId);
    if (taken && taken.actor_id !== actor.id) {
      throw errors.conflict("This import id belongs to another import.", "IMPORT_ID_CONFLICT");
    }
  }

  // Validation happens after the file-identity check so a different file is
  // rejected as a mismatch, not reported as a validation problem.
  const preview = await previewCustomerImport(rows);

  if (!operation) {
    await db
      .prepare(
        `INSERT INTO customer_import_operations
           (id, actor_id, status, total_rows, imported_rows, failed_rows, created_at, updated_at, file_fingerprint, parser_version)
         VALUES (?, ?, 'PENDING', ?, 0, 0, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      )
      .bind(importId, actor.id, rows.length, now, now, identity.fingerprint, identity.parserVersion)
      .run();
    operation = await loadOperation(db, importId, actor.id);
    if (!operation) {
      throw errors.conflict("This import id belongs to another import.", "IMPORT_ID_CONFLICT");
    }
    // A simultaneous writer may have won the insert with a different file.
    assertSameFile(operation, identity.fingerprint);
  }

  const previous = await all<{ row_index: number; status: string; customer_id: string | null; error_code: string | null; error_message: string | null }>(
    db,
    "SELECT row_index, status, customer_id, error_code, error_message FROM customer_import_rows WHERE import_id = ?",
    importId,
  );
  const done = new Map(previous.map((row) => [row.row_index, row]));

  const results: ImportRowResult[] = [];
  let skipped = 0;

  // Validation failures are row outcomes, not a reason to discard the file.
  // They are recorded before the valid rows run so the summary is truthful.
  for (const issue of preview.errors) {
    const existing = done.get(issue.row);
    if (existing?.status === "IMPORTED") {
      skipped += 1;
      continue;
    }
    await recordFailedRow(db, importId, issue.row, "", issue.code, issue.message, now);
    results.push({ row: issue.row, legalName: "", status: "FAILED", errorCode: issue.code, errorMessage: issue.message });
  }

  for (const row of preview.valid) {
    // The CSV line number is the stable identity of a row inside the file.
    const rowIndex = row.row;
    const existing = done.get(rowIndex);
    if (existing?.status === "IMPORTED") {
      skipped += 1;
      continue;
    }
    try {
      const customerId = await deterministicCustomerId(importId, rowIndex);
      const customer = await createCustomer(
        db,
        actor,
        {
          legalName: row.legalName,
          countryCode: row.countryCode,
          contacts: row.phone ? [{ fullName: row.legalName, phone: row.phone }] : [],
        },
        requestId,
        { id: customerId },
      );
      await recordImportedRow(db, importId, rowIndex, row.legalName, customer.id, now);
      results.push({ row: rowIndex, legalName: row.legalName, status: "IMPORTED", customerId: customer.id });
    } catch (error) {
      // A concurrent retry may have committed the same deterministic customer
      // id. The primary key is the final guard: never create a second row.
      const collisionId = await deterministicCustomerId(importId, rowIndex);
      if (isCustomerIdCollision(error)) {
        const existing = await one<{ id: string }>(db, "SELECT id FROM customers WHERE id = ?", collisionId);
        if (existing) {
          await recordImportedRow(db, importId, rowIndex, row.legalName, existing.id, now);
          results.push({ row: rowIndex, legalName: row.legalName, status: "IMPORTED", customerId: existing.id });
          continue;
        }
      }
      const status = error instanceof HttpError ? error.status : 500;
      const code = error instanceof HttpError ? error.code : "IMPORT_ROW_FAILED";
      const message = error instanceof Error ? error.message : "The row could not be imported.";
      await recordFailedRow(db, importId, rowIndex, row.legalName, code, message, now);
      results.push({ row: rowIndex, legalName: row.legalName, status: "FAILED", errorCode: code, errorMessage: message });
      if (status === 403) {
        // A permission problem affects every following row as well.
        break;
      }
    }
  }

  const totals = await one<{ imported_rows: number; failed_rows: number }>(
    db,
    "SELECT SUM(CASE WHEN status = 'IMPORTED' THEN 1 ELSE 0 END) AS imported_rows, SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS failed_rows FROM customer_import_rows WHERE import_id = ?",
    importId,
  );
  const importedTotal = Number(totals?.imported_rows ?? 0);
  const failedTotal = Number(totals?.failed_rows ?? 0);
  const status = failedTotal > 0 ? "PARTIAL" : "COMPLETED";
  await db
    .prepare(
      `UPDATE customer_import_operations
       SET status = ?, imported_rows = ?, failed_rows = ?, updated_at = ?
       WHERE id = ? AND actor_id = ?`,
    )
    .bind(status, importedTotal, failedTotal, now, importId, actor.id)
    .run();

  return {
    importId,
    status,
    totalRows: rows.length,
    imported: importedTotal,
    failed: failedTotal,
    skipped,
    fingerprint: identity.fingerprint,
    parserVersion: identity.parserVersion,
    rows: results,
  };
}

function assertSameFile(operation: ImportOperation, fingerprint: string) {
  if (!operation.file_fingerprint) {
    throw new HttpError(
      409,
      "IMPORT_FINGERPRINT_MISSING",
      "This import was created before file identity was recorded. Start a new import id for this file; the old progress is preserved.",
    );
  }
  if (operation.file_fingerprint !== fingerprint) {
    throw new HttpError(
      409,
      "IMPORT_FILE_MISMATCH",
      "This import id is already bound to a different CSV file. Start a new import id instead of changing the file.",
    );
  }
}

function loadOperation(db: D1Database, importId: string, actorId: string) {
  return one<ImportOperation>(
    db,
    "SELECT id, status, total_rows, file_fingerprint, parser_version FROM customer_import_operations WHERE id = ? AND actor_id = ?",
    importId,
    actorId,
  );
}

function recordFailedRow(
  db: D1Database,
  importId: string,
  rowIndex: number,
  legalName: string,
  code: string,
  message: string,
  now: string,
) {
  return db
    .prepare(
      `INSERT INTO customer_import_rows (id, import_id, row_index, legal_name, status, customer_id, error_code, error_message, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'FAILED', NULL, ?, ?, ?, ?)
       ON CONFLICT(import_id, row_index) DO UPDATE SET
         status = 'FAILED', customer_id = NULL, error_code = excluded.error_code,
         error_message = excluded.error_message, updated_at = excluded.updated_at`,
    )
    .bind(newId(), importId, rowIndex, legalName, code, message, now, now)
    .run();
}

function recordImportedRow(
  db: D1Database,
  importId: string,
  rowIndex: number,
  legalName: string,
  customerId: string,
  now: string,
) {
  return db
    .prepare(
      `INSERT INTO customer_import_rows (id, import_id, row_index, legal_name, status, customer_id, error_code, error_message, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'IMPORTED', ?, NULL, NULL, ?, ?)
       ON CONFLICT(import_id, row_index) DO UPDATE SET
         status = 'IMPORTED', customer_id = excluded.customer_id, error_code = NULL,
         error_message = NULL, updated_at = excluded.updated_at`,
    )
    .bind(newId(), importId, rowIndex, legalName, customerId, now, now)
    .run();
}

async function deterministicCustomerId(importId: string, rowIndex: number): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`customer-import:${importId}:${rowIndex}`),
  );
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `imp-${hex.slice(0, 32)}`;
}

function isCustomerIdCollision(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /UNIQUE constraint failed: customers\.id|SQLITE_CONSTRAINT.*customers\.id/i.test(message);
}
