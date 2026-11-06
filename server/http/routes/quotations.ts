import type { Hono } from "hono";
import {
  addQuotationItem,
  archiveQuotation,
  copyQuotationItems,
  createQuotation,
  deleteQuotationItem,
  exportQuotationsCsv,
  generateQuotationPdf,
  getQuotation,
  issueQuotation,
  linkQuotationToCase,
  listQuotationRevisions,
  listQuotations,
  recordQuotationResponse,
  reviseQuotation,
  unlinkQuotationFromCase,
  updateQuotation,
  updateQuotationItem,
} from "../../services/quotations";
import { jsonSuccess } from "../errors";
import type { AppEnv } from "../types";

export function mountQuotationRoutes(api: Hono<AppEnv>) {
  api.get("/quotations", async (c) => jsonSuccess(await listQuotations(c.env.DB, c.get("actor"), c.req.query()), c.get("requestId")));
  api.get("/quotations.csv", async (c) => {
    const csv = await exportQuotationsCsv(c.env.DB, c.get("actor"));
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="exportflow-quotations.csv"',
        "Cache-Control": "no-store",
      },
    });
  });
  api.get("/quotations/:id", async (c) => jsonSuccess(await getQuotation(c.env.DB, c.get("actor"), c.req.param("id")), c.get("requestId")));
  api.get("/quotations/:id/revisions", async (c) => jsonSuccess(await listQuotationRevisions(c.env.DB, c.get("actor"), c.req.param("id")), c.get("requestId")));
  api.get("/quotations/:id/pdf", async (c) => {
    const pdf = await generateQuotationPdf(c.env.DB, c.get("actor"), c.req.param("id"), c.req.query("revision"));
    return new Response(pdf.bytes, {
      headers: {
        "Content-Type": pdf.contentType,
        "Content-Disposition": `attachment; filename="${pdf.filename}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
  api.post("/quotations", async (c) => jsonSuccess(await createQuotation(c.env.DB, c.get("actor"), await c.req.json(), c.get("requestId")), c.get("requestId"), {}, 201));
  api.put("/quotations/:id", async (c) => {
    await updateQuotation(c.env.DB, c.get("actor"), c.req.param("id"), await c.req.json(), c.get("requestId"));
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });
  api.post("/quotations/:id/items", async (c) => jsonSuccess(await addQuotationItem(c.env.DB, c.get("actor"), c.req.param("id"), await c.req.json(), c.get("requestId")), c.get("requestId"), {}, 201));
  api.put("/quotations/:id/items/:itemId", async (c) => {
    await updateQuotationItem(c.env.DB, c.get("actor"), c.req.param("id"), c.req.param("itemId"), await c.req.json(), c.get("requestId"));
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });
  api.delete("/quotations/:id/items/:itemId", async (c) => {
    await deleteQuotationItem(c.env.DB, c.get("actor"), c.req.param("id"), c.req.param("itemId"), c.get("requestId"));
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });
  api.post("/quotations/:id/issue", async (c) => {
    const input = await c.req.json().catch(() => ({}));
    return jsonSuccess(await issueQuotation(c.env.DB, c.get("actor"), c.req.param("id"), input, c.get("requestId")), c.get("requestId"));
  });
  api.post("/quotations/:id/revise", async (c) =>
    jsonSuccess(await reviseQuotation(c.env.DB, c.get("actor"), c.req.param("id"), await c.req.json(), c.get("requestId")), c.get("requestId")),
  );
  api.post("/quotations/:id/response", async (c) => {
    await recordQuotationResponse(c.env.DB, c.get("actor"), c.req.param("id"), await c.req.json(), c.get("requestId"));
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });
  api.post("/quotations/:id/link", async (c) =>
    jsonSuccess(await linkQuotationToCase(c.env.DB, c.get("actor"), c.req.param("id"), await c.req.json(), c.get("requestId")), c.get("requestId")),
  );
  api.post("/quotations/:id/unlink", async (c) => {
    await unlinkQuotationFromCase(c.env.DB, c.get("actor"), c.req.param("id"), await c.req.json(), c.get("requestId"));
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });
  api.post("/quotations/:id/copy-items", async (c) => {
    await copyQuotationItems(c.env.DB, c.get("actor"), c.req.param("id"), await c.req.json(), c.get("requestId"));
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });
  api.post("/quotations/:id/archive", async (c) => {
    await archiveQuotation(c.env.DB, c.get("actor"), c.req.param("id"), await c.req.json(), c.get("requestId"));
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });
}
