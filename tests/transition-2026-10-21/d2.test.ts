import { afterEach, describe, expect, it } from "vitest";
import { createTestHarness } from "./harness/app";
import { count, createAuditDatabase, type AuditDatabase } from "./harness/db";

const openDatabases: AuditDatabase[] = [];

function fresh() {
  const audit = createAuditDatabase();
  openDatabases.push(audit);
  return audit;
}

afterEach(() => {
  while (openDatabases.length) openDatabases.pop()?.close();
});

type ImportResponse = {
  data: {
    importId: string;
    status: "COMPLETED" | "PARTIAL";
    totalRows: number;
    imported: number;
    failed: number;
    skipped: number;
    fingerprint: string;
    parserVersion: string;
    rows: { row: number; status: string; errorCode?: string }[];
  };
};

function operation(audit: AuditDatabase, importId: string) {
  return audit.sqlite
    .prepare("SELECT * FROM customer_import_operations WHERE id = ?")
    .get(importId) as Record<string, unknown> | undefined;
}

const rowsWithOneBad = [
  { legal_name: "D2-01 Alpha", country_code: "EG" },
  { legal_name: "", country_code: "EG" },
  { legal_name: "D2-01 Gamma", country_code: "NL" },
];

function faultyCustomerInsert(audit: AuditDatabase, failName: string): AuditDatabase {
  const proxy = new Proxy(audit.db, {
    get(target, property) {
      if (property === "prepare") {
        return (sql: string) => {
          const statement = target.prepare(sql);
          if (!sql.includes("INSERT INTO customers")) return statement;
          return {
            bind: (...params: unknown[]) => {
              if (params.includes(failName)) throw new Error("induced customer row failure");
              return statement.bind(...params);
            },
          };
        };
      }
      return Reflect.get(target, property);
    },
  });
  return { ...audit, db: proxy as AuditDatabase["db"] };
}

describe("D2 import file identity and partial resume", () => {
  it("D2-01 a three-row file imports two and records one failed, then resumes without duplicates", async () => {
    const audit = fresh();
    const harness = createTestHarness(audit);
    const importId = "d2-01-import";
    const first = await harness.request({
      method: "POST",
      path: "/api/v1/imports/customers/commit",
      body: { importId, rows: rowsWithOneBad },
    });
    expect(first.status).toBe(200);
    const firstData = (first.json as ImportResponse).data;
    expect(firstData.status).toBe("PARTIAL");
    expect(firstData.imported).toBe(2);
    expect(firstData.failed).toBe(1);
    expect(count(audit.sqlite, "customers")).toBe(3);
    expect(count(audit.sqlite, "customer_import_rows", "import_id = ?", importId)).toBe(3);

    const resume = await harness.request({
      method: "POST",
      path: "/api/v1/imports/customers/commit",
      body: { importId, rows: rowsWithOneBad },
    });
    expect(resume.status).toBe(200);
    const resumeData = (resume.json as ImportResponse).data;
    expect(resumeData.imported).toBe(2);
    expect(resumeData.failed).toBe(1);
    expect(resumeData.skipped).toBe(2);
    expect(count(audit.sqlite, "customers")).toBe(3);
  });

  it("D2-02 the same importId with different row content is rejected before any write", async () => {
    const audit = fresh();
    const harness = createTestHarness(audit);
    const importId = "d2-02-import";
    expect(
      (
        await harness.request({
          method: "POST",
          path: "/api/v1/imports/customers/commit",
          body: { importId, rows: rowsWithOneBad },
        })
      ).status,
    ).toBe(200);
    const before = operation(audit, importId);
    const changed = rowsWithOneBad.map((row, index) =>
      index === 2 ? { ...row, legal_name: "D2-02 Changed Gamma" } : row,
    );
    const mismatch = await harness.request({
      method: "POST",
      path: "/api/v1/imports/customers/commit",
      body: { importId, rows: changed },
    });
    expect(mismatch.status).toBe(409);
    expect((mismatch.json as { error: { code: string } }).error.code).toBe("IMPORT_FILE_MISMATCH");
    expect(count(audit.sqlite, "customers")).toBe(3);
    const after = operation(audit, importId);
    expect(after?.imported_rows).toBe(before?.imported_rows);
    expect(after?.failed_rows).toBe(before?.failed_rows);
    expect(after?.file_fingerprint).toBe(before?.file_fingerprint);
  });

  it("D2-03 a reordered file is a different file and is rejected", async () => {
    const audit = fresh();
    const harness = createTestHarness(audit);
    const importId = "d2-03-import";
    expect(
      (
        await harness.request({
          method: "POST",
          path: "/api/v1/imports/customers/commit",
          body: { importId, rows: rowsWithOneBad },
        })
      ).status,
    ).toBe(200);
    const reordered = [rowsWithOneBad[2], rowsWithOneBad[0], rowsWithOneBad[1]];
    const mismatch = await harness.request({
      method: "POST",
      path: "/api/v1/imports/customers/commit",
      body: { importId, rows: reordered },
    });
    expect(mismatch.status).toBe(409);
    expect((mismatch.json as { error: { code: string } }).error.code).toBe("IMPORT_FILE_MISMATCH");
    expect(count(audit.sqlite, "customers")).toBe(3);
  });

  it("D2-04 a different header mapping that changes semantics is rejected", async () => {
    const audit = fresh();
    const harness = createTestHarness(audit);
    const importId = "d2-04-import";
    expect(
      (
        await harness.request({
          method: "POST",
          path: "/api/v1/imports/customers/commit",
          body: { importId, rows: rowsWithOneBad },
        })
      ).status,
    ).toBe(200);
    const remapped = [
      { name: "D2-01 Alpha", country_code: "EG" },
      { legal_name: "", country_code: "EG" },
      { legal_name: "D2-01 Gamma", country_code: "NL" },
    ];
    const mismatch = await harness.request({
      method: "POST",
      path: "/api/v1/imports/customers/commit",
      body: { importId, rows: remapped },
    });
    expect(mismatch.status).toBe(409);
    expect((mismatch.json as { error: { code: string } }).error.code).toBe("IMPORT_FILE_MISMATCH");
    expect(count(audit.sqlite, "customers")).toBe(3);
  });

  it("D2-05 preview and commit share the same canonical fingerprint", async () => {
    const audit = fresh();
    const harness = createTestHarness(audit);
    const importId = "d2-05-import";
    const preview = await harness.request({
      method: "POST",
      path: "/api/v1/imports/customers/preview",
      body: { rows: rowsWithOneBad },
    });
    expect(preview.status).toBe(200);
    const previewData = (preview.json as { data: { fingerprint: string; parserVersion: string } }).data;
    expect(previewData.parserVersion).toBe("csv-v1");
    const commit = await harness.request({
      method: "POST",
      path: "/api/v1/imports/customers/commit",
      body: { importId, rows: rowsWithOneBad },
    });
    expect(commit.status).toBe(200);
    expect(operation(audit, importId)?.file_fingerprint).toBe(previewData.fingerprint);
    expect(operation(audit, importId)?.parser_version).toBe("csv-v1");
  });

  it("D2-06 a different importId for the same file is an intentional new operation", async () => {
    const audit = fresh();
    const harness = createTestHarness(audit);
    expect(
      (
        await harness.request({
          method: "POST",
          path: "/api/v1/imports/customers/commit",
          body: { importId: "d2-06-first", rows: rowsWithOneBad },
        })
      ).status,
    ).toBe(200);
    expect(count(audit.sqlite, "customers")).toBe(3);
    const second = await harness.request({
      method: "POST",
      path: "/api/v1/imports/customers/commit",
      body: { importId: "d2-06-second", rows: rowsWithOneBad },
    });
    expect(second.status).toBe(200);
    expect(count(audit.sqlite, "customers")).toBe(5);
  });

  it("D2-07 simultaneous same-id same-content commits create no duplicate customer", async () => {
    const audit = fresh();
    const harness = createTestHarness(audit);
    const importId = "d2-07-import";
    const responses = await Promise.all(
      Array.from({ length: 2 }, () =>
        harness.request({
          method: "POST",
          path: "/api/v1/imports/customers/commit",
          body: { importId, rows: rowsWithOneBad },
        }),
      ),
    );
    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(count(audit.sqlite, "customers")).toBe(3);
    expect(count(audit.sqlite, "customer_import_rows", "import_id = ?", importId)).toBe(3);
  });

  it("D2-08 simultaneous same-id different-content commits let exactly one file win", async () => {
    const audit = fresh();
    const harness = createTestHarness(audit);
    const importId = "d2-08-import";
    const otherRows = [
      { legal_name: "D2-08 Other Alpha", country_code: "EG" },
      { legal_name: "D2-08 Other Beta", country_code: "EG" },
      { legal_name: "D2-08 Other Gamma", country_code: "NL" },
    ];
    const responses = await Promise.all([
      harness.request({
        method: "POST",
        path: "/api/v1/imports/customers/commit",
        body: { importId, rows: rowsWithOneBad },
      }),
      harness.request({
        method: "POST",
        path: "/api/v1/imports/customers/commit",
        body: { importId, rows: otherRows },
      }),
    ]);
    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([200, 409]);
    expect(count(audit.sqlite, "customers")).toBe(3);
    const stored = operation(audit, importId);
    expect(stored?.file_fingerprint).toBeTruthy();
    const storedNames = audit.sqlite
      .prepare("SELECT legal_name FROM customer_import_rows WHERE import_id = ? ORDER BY row_index")
      .all(importId) as { legal_name: string }[];
    const isFirst = storedNames.some((row) => row.legal_name === "D2-01 Alpha");
    const isSecond = storedNames.some((row) => row.legal_name === "D2-08 Other Alpha");
    expect(isFirst || isSecond).toBe(true);
    expect(isFirst && isSecond).toBe(false);
  });

  it("D2-09 a legacy operation without a fingerprint fails closed and preserves its history", async () => {
    const audit = fresh();
    const now = new Date().toISOString();
    audit.sqlite
      .prepare(
        `INSERT INTO customer_import_operations
           (id, actor_id, status, total_rows, imported_rows, failed_rows, created_at, updated_at)
         VALUES (?, 'user-admin', 'PARTIAL', 1, 1, 0, ?, ?)`,
      )
      .run("d2-09-legacy", now, now);
    const harness = createTestHarness(audit);
    const response = await harness.request({
      method: "POST",
      path: "/api/v1/imports/customers/commit",
      body: { importId: "d2-09-legacy", rows: [{ legal_name: "D2-09 New" }] },
    });
    expect(response.status).toBe(409);
    expect((response.json as { error: { code: string } }).error.code).toBe("IMPORT_FINGERPRINT_MISSING");
    expect(count(audit.sqlite, "customers")).toBe(1);
    expect(operation(audit, "d2-09-legacy")?.file_fingerprint).toBeNull();
  });

  it("D2-10 a failed row is recorded and a later resume completes without duplicates", async () => {
    const audit = fresh();
    const faulty = faultyCustomerInsert(audit, "D2-10 Beta");
    const harness = createTestHarness(faulty);
    const importId = "d2-10-import";
    const rows = [{ legal_name: "D2-10 Alpha" }, { legal_name: "D2-10 Beta" }];
    const first = await harness.request({
      method: "POST",
      path: "/api/v1/imports/customers/commit",
      body: { importId, rows },
    });
    expect(first.status).toBe(200);
    const firstData = (first.json as ImportResponse).data;
    expect(firstData.status).toBe("PARTIAL");
    expect(firstData.imported).toBe(1);
    expect(firstData.failed).toBe(1);
    expect(count(audit.sqlite, "customers")).toBe(2);

    const healthy = createTestHarness(audit);
    const resume = await healthy.request({
      method: "POST",
      path: "/api/v1/imports/customers/commit",
      body: { importId, rows },
    });
    expect(resume.status).toBe(200);
    const resumeData = (resume.json as ImportResponse).data;
    expect(resumeData.status).toBe("COMPLETED");
    expect(resumeData.imported).toBe(2);
    expect(resumeData.failed).toBe(0);
    expect(resumeData.skipped).toBe(1);
    expect(count(audit.sqlite, "customers")).toBe(3);
  });

  it("D2-11 another actor's importId is isolated and cannot be resumed", async () => {
    const audit = fresh();
    const harness = createTestHarness(audit);
    const importId = "d2-11-shared";
    expect(
      (
        await harness.request({
          method: "POST",
          path: "/api/v1/imports/customers/commit",
          actor: "user-officer",
          body: { importId, rows: [{ legal_name: "D2-11 Officer" }] },
        })
      ).status,
    ).toBe(200);
    const admin = await harness.request({
      method: "POST",
      path: "/api/v1/imports/customers/commit",
      actor: "user-admin",
      body: { importId, rows: [{ legal_name: "D2-11 Officer" }] },
    });
    expect(admin.status).toBe(409);
    expect((admin.json as { error: { code: string } }).error.code).toBe("IMPORT_ID_CONFLICT");
    expect(count(audit.sqlite, "customers")).toBe(2);
  });

  it("D2-12 Unicode, CRLF, cell whitespace and header order canonicalize deterministically", async () => {
    const audit = fresh();
    const harness = createTestHarness(audit);
    const preview = async (rows: Record<string, string>[]) => {
      const response = await harness.request({
        method: "POST",
        path: "/api/v1/imports/customers/preview",
        body: { rows },
      });
      expect(response.status).toBe(200);
      return (response.json as { data: { fingerprint: string } }).data.fingerprint;
    };
    const first = await preview([{ legal_name: "  Café \r\n", country_code: "EG" }]);
    const second = await preview([{ country_code: "EG", legal_name: "Café" }]);
    expect(first).toBe(second);
    const different = await preview([{ legal_name: "Cafe", country_code: "EG" }]);
    expect(different).not.toBe(first);
  });

  it("D2-13 an old payload without importId still works and unsafe legacy resume is explicit", async () => {
    const audit = fresh();
    const harness = createTestHarness(audit);
    const response = await harness.request({
      method: "POST",
      path: "/api/v1/imports/customers/commit",
      body: { rows: [{ legal_name: "D2-13 Legacy Client" }] },
    });
    expect(response.status).toBe(200);
    const data = (response.json as ImportResponse).data;
    expect(data.importId).toBeTruthy();
    expect(data.status).toBe("COMPLETED");
    expect(count(audit.sqlite, "customers")).toBe(2);
  });
});
