import type { Hono } from "hono";
import { requirePermission } from "../../services/actor";
import {
  correctCompletedInvoice,
  createCase,
  createInvoice,
  getCaseOverview,
  listCases,
  listInvoiceRevisions,
  setInvoiceEditWindow,
  transitionCase,
  updateInvoice,
} from "../../services/cases";
import { createCustomer, getCustomer, listCustomers, updateCustomer } from "../../services/customers";
import { changeDocumentRoute } from "../../services/documents";
import { jsonSuccess } from "../errors";
import type { AppEnv } from "../types";
import { mountCustomFields } from "./mount-custom-fields";

export function mountCaseRoutes(api: Hono<AppEnv>) {
  api.get("/customers", async (c) => {
    requirePermission(c.get("actor"), "customers.view");
    const result = await listCustomers(c.env.DB, {
      page: Number(c.req.query("page") ?? 1),
      pageSize: Number(c.req.query("pageSize") ?? 20),
      q: c.req.query("q") ?? undefined,
    });
    return jsonSuccess(result.rows, c.get("requestId"), { page: result.page, pageSize: result.pageSize, total: result.total });
  });
  api.post("/customers", async (c) => jsonSuccess(await createCustomer(c.env.DB, c.get("actor"), await c.req.json(), c.get("requestId")), c.get("requestId"), {}, 201));
  api.get("/customers/:id", async (c) => {
    requirePermission(c.get("actor"), "customers.view");
    return jsonSuccess(await getCustomer(c.env.DB, c.get("actor"), c.req.param("id")), c.get("requestId"));
  });
  api.put("/customers/:id", async (c) => {
    await updateCustomer(c.env.DB, c.get("actor"), c.req.param("id"), await c.req.json(), c.get("requestId"));
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });
  mountCustomFields(api, "/customers/:id", "CUSTOMER");

  api.get("/export-cases", async (c) => {
    const result = await listCases(c.env.DB, c.get("actor"), {
      page: Number(c.req.query("page") ?? 1),
      pageSize: Number(c.req.query("pageSize") ?? 20),
      q: c.req.query("q") ?? undefined,
      status: c.req.query("status") ?? undefined,
      country: c.req.query("country") ?? undefined,
    });
    return jsonSuccess(result.rows, c.get("requestId"), { page: result.page, pageSize: result.pageSize, total: result.total });
  });
  api.post("/export-cases", async (c) => jsonSuccess(await createCase(c.env.DB, c.get("actor"), c.env, await c.req.json(), c.get("requestId")), c.get("requestId"), {}, 201));
  api.get("/export-cases/:id", async (c) => jsonSuccess(await getCaseOverview(c.env.DB, c.get("actor"), c.req.param("id")), c.get("requestId")));
  mountCustomFields(api, "/export-cases/:id", "EXPORT_CASE");
  mountCustomFields(api, "/invoices/:id", "INVOICE");
  api.post("/export-cases/:id/status", async (c) => {
    const body = await c.req.json<{ to: never; reason?: string; version: number }>();
    await transitionCase(c.env.DB, c.get("actor"), c.env, c.req.param("id"), body.to, body, c.get("requestId"));
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });
  api.post("/export-cases/:id/route", async (c) => {
    const body = await c.req.json<{ to: never }>();
    await changeDocumentRoute(c.env.DB, c.get("actor"), c.env, c.req.param("id"), body.to, c.get("requestId"));
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });
  api.post("/export-cases/:id/invoices", async (c) => jsonSuccess(await createInvoice(c.env.DB, c.get("actor"), c.env, c.req.param("id"), await c.req.json(), c.get("requestId")), c.get("requestId"), {}, 201));
  api.put("/invoices/:id", async (c) => {
    await updateInvoice(c.env.DB, c.get("actor"), c.req.param("id"), await c.req.json(), c.get("requestId"));
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });
  api.get("/invoices/:id/revisions", async (c) => jsonSuccess(await listInvoiceRevisions(c.env.DB, c.get("actor"), c.req.param("id")), c.get("requestId")));
  api.post("/invoices/:id/edit-window", async (c) => {
    await setInvoiceEditWindow(c.env.DB, c.get("actor"), c.req.param("id"), await c.req.json(), c.get("requestId"));
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });
  api.post("/invoices/:id/corrections", async (c) =>
    jsonSuccess(
      await correctCompletedInvoice(c.env.DB, c.get("actor"), c.req.param("id"), await c.req.json(), c.get("requestId"), {
        allowTestFault: c.env.EXPORTFLOW_TEST_FAULTS === "1",
      }),
      c.get("requestId"),
    ),
  );
}
