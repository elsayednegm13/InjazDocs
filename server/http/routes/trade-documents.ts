import type { Hono } from "hono";
import {
  convertProforma,
  createProforma,
  getExporterIdentity,
  getExporterMarks,
  getProforma,
  issueProforma,
  issueTradeDocuments,
  listExporterBanks,
  listProformas,
  uploadExporterMark,
  listProductPresets,
  reconciliationFor,
  replaceInvoiceLines,
  replacePackingLines,
  saveExporterBank,
  saveExporterIdentity,
  saveExporterMarks,
  saveProductPreset,
  saveTradeHeader,
  syncPackingTotals,
  tradeSheet,
  updateProforma,
} from "../../services/trade-documents";
import { invoicePdfBytes, proformaPdfBytes } from "../../services/trade-document-files";
import { errors, jsonSuccess } from "../errors";
import type { AppEnv } from "../types";

export function mountTradeRoutes(api: Hono<AppEnv>) {
  api.get("/settings/exporter-identity", async (c) => jsonSuccess(await getExporterIdentity(c.env.DB, c.get("actor")), c.get("requestId")));
  api.put("/settings/exporter-identity", async (c) => jsonSuccess(await saveExporterIdentity(c.env.DB, c.get("actor"), await c.req.json()), c.get("requestId")));
  api.get("/settings/exporter-bank-accounts", async (c) => jsonSuccess(await listExporterBanks(c.env.DB, c.get("actor")), c.get("requestId")));
  api.post("/settings/exporter-bank-accounts", async (c) => jsonSuccess(await saveExporterBank(c.env.DB, c.get("actor"), await c.req.json()), c.get("requestId"), {}, 201));
  api.patch("/settings/exporter-bank-accounts/:id", async (c) => jsonSuccess(await saveExporterBank(c.env.DB, c.get("actor"), await c.req.json(), c.req.param("id")), c.get("requestId")));
  api.get("/settings/exporter-marks", async (c) => jsonSuccess(await getExporterMarks(c.env.DB, c.get("actor")), c.get("requestId")));
  api.put("/settings/exporter-marks", async (c) => jsonSuccess(await saveExporterMarks(c.env.DB, c.get("actor"), await c.req.json()), c.get("requestId")));
  api.post("/settings/exporter-marks/:kind", async (c) => {
    const kind = c.req.param("kind");
    if (kind !== "logo" && kind !== "stamp") throw errors.notFound("Image kind not found");
    const body = await c.req.json<{ dataUrl?: string }>();
    return jsonSuccess(await uploadExporterMark(c.env.DB, c.env.DOCUMENTS, c.get("actor"), kind, body.dataUrl ?? ""), c.get("requestId"));
  });

  api.get("/product-presets", async (c) => jsonSuccess(await listProductPresets(c.env.DB, c.get("actor")), c.get("requestId")));
  api.post("/product-presets", async (c) => jsonSuccess(await saveProductPreset(c.env.DB, c.get("actor"), await c.req.json()), c.get("requestId"), {}, 201));
  api.patch("/product-presets/:id", async (c) => jsonSuccess(await saveProductPreset(c.env.DB, c.get("actor"), await c.req.json(), c.req.param("id")), c.get("requestId")));

  api.get("/proformas", async (c) => jsonSuccess(await listProformas(c.env.DB, c.get("actor"), c.req.query("caseId") || undefined), c.get("requestId")));
  api.post("/proformas", async (c) => jsonSuccess(await createProforma(c.env.DB, c.get("actor"), await c.req.json()), c.get("requestId"), {}, 201));
  api.get("/proformas/:id", async (c) => jsonSuccess(await getProforma(c.env.DB, c.get("actor"), c.req.param("id")), c.get("requestId")));
  api.put("/proformas/:id", async (c) => jsonSuccess(await updateProforma(c.env.DB, c.get("actor"), c.req.param("id"), await c.req.json()), c.get("requestId")));
  api.post("/proformas/:id/issue", async (c) => jsonSuccess(await issueProforma(c.env.DB, c.env.DOCUMENTS, c.get("actor"), c.req.param("id")), c.get("requestId")));
  api.get("/proformas/:id/pdf", async (c) => pdfResponse(await proformaPdfBytes(c.env.DB, c.env.DOCUMENTS, c.get("actor"), c.req.param("id")), "proforma.pdf"));
  api.post("/proformas/:id/convert", async (c) => jsonSuccess(await convertProforma(c.env.DB, c.get("actor"), c.req.param("id")), c.get("requestId")));

  api.get("/invoices/:id/trade-sheet", async (c) => jsonSuccess(await tradeSheet(c.env.DB, c.get("actor"), c.req.param("id")), c.get("requestId")));
  api.put("/invoices/:id/trade-header", async (c) => jsonSuccess(await saveTradeHeader(c.env.DB, c.get("actor"), c.req.param("id"), await c.req.json()), c.get("requestId")));
  api.put("/invoices/:id/lines", async (c) => {
    const body = await c.req.json<{ lines: unknown }>();
    return jsonSuccess(await replaceInvoiceLines(c.env.DB, c.get("actor"), c.req.param("id"), body.lines), c.get("requestId"));
  });
  api.put("/invoices/:id/packing-lines", async (c) => {
    const body = await c.req.json<{ lines: unknown }>();
    return jsonSuccess(await replacePackingLines(c.env.DB, c.get("actor"), c.req.param("id"), body.lines), c.get("requestId"));
  });
  api.post("/invoices/:id/sync-totals", async (c) => jsonSuccess(await syncPackingTotals(c.env.DB, c.get("actor"), c.req.param("id")), c.get("requestId")));
  api.get("/invoices/:id/reconciliation", async (c) => jsonSuccess(await reconciliationFor(c.env.DB, c.get("actor"), c.req.param("id")), c.get("requestId")));
  api.post("/invoices/:id/issue-trade", async (c) => jsonSuccess(await issueTradeDocuments(c.env.DB, c.env.DOCUMENTS, c.get("actor"), c.req.param("id")), c.get("requestId")));
  api.get("/invoices/:id/commercial-pdf", async (c) => pdfResponse(await invoicePdfBytes(c.env.DB, c.env.DOCUMENTS, c.get("actor"), c.req.param("id"), "commercial"), "commercial-invoice.pdf"));
  api.get("/invoices/:id/packing-pdf", async (c) => pdfResponse(await invoicePdfBytes(c.env.DB, c.env.DOCUMENTS, c.get("actor"), c.req.param("id"), "packing"), "packing-list.pdf"));
  api.get("/invoices/:id/customs-pdf", async (c) => pdfResponse(await invoicePdfBytes(c.env.DB, c.env.DOCUMENTS, c.get("actor"), c.req.param("id"), "customs"), "customs-bundle.pdf"));
}

function pdfResponse(bytes: Uint8Array, filename: string) {
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
