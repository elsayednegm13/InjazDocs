import { describe, expect, it } from "vitest";
import { HttpError, publicMessage } from "../server/http/errors";

describe("safe public errors", () => {
  it("never returns SQL or D1 internals", () => {
    const leaked = publicMessage(new Error("D1_ERROR: SQLITE_CONSTRAINT_NOTNULL: NOT NULL constraint failed: operation_document_requirements.document_type_id"));
    expect(leaked.status).toBe(500);
    expect(leaked.code).toBe("SERVER_TEMPORARILY_UNAVAILABLE");
    expect(leaked.message).not.toMatch(/SQLITE|CONSTRAINT|D1_|document_type_id/i);
  });

  it("keeps known validation codes and field errors", () => {
    const error = new HttpError(422, "DOCUMENT_TYPE_REQUIRED", "Choose a document type before adding it.", {
      documentTypeId: "Choose a document type.",
    });
    const safe = publicMessage(error);
    expect(safe.status).toBe(422);
    expect(safe.code).toBe("DOCUMENT_TYPE_REQUIRED");
    expect(safe.fieldErrors?.documentTypeId).toBeTruthy();
    expect(JSON.stringify(safe)).not.toMatch(/SQLITE|stack/i);
  });
});
