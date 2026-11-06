import type { Hono } from "hono";
import { all, one } from "../../db/sql";
import { requirePermission } from "../../services/actor";
import { createCustomFieldDefinition, listAvailableCustomFieldDefinitions, listCustomFieldDefinitions, updateCustomFieldDefinition } from "../../services/custom-fields";
import { commitCustomerImport } from "../../services/imports";
import { casesCsv, delayReport, overview, previewCustomerImport } from "../../services/reports";
import { jsonSuccess } from "../errors";
import type { AppEnv } from "../types";

export function mountReportRoutes(api: Hono<AppEnv>) {
  api.get("/lookups", async (c) => {
    const ports = await all(c.env.DB, "SELECT * FROM ports ORDER BY name");
    const paymentTerms = await all(c.env.DB, "SELECT * FROM payment_term_types");
    const settings = await one(
      c.env.DB,
      `SELECT id, exporter_display_name, timezone, incoterms_edition, max_upload_bytes, currency_default, updated_at
       FROM company_settings WHERE id = 'default'`,
    );
    return jsonSuccess({ ports, paymentTerms, settings }, c.get("requestId"));
  });

  api.get("/dashboard", async (c) => jsonSuccess(await overview(c.env.DB, c.get("actor")), c.get("requestId")));

  api.get("/reports/overview", async (c) => jsonSuccess(await overview(c.env.DB, c.get("actor"), "reports"), c.get("requestId")));
  api.get("/reports/delays", async (c) => jsonSuccess(await delayReport(c.env.DB, c.get("actor")), c.get("requestId")));
  api.get("/exports/csv", async (c) => {
    const csv = await casesCsv(c.env.DB, c.get("actor"));
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="exportflow-cases.csv"',
        "Cache-Control": "no-store",
      },
    });
  });
  api.post("/imports/customers/preview", async (c) => {
    requirePermission(c.get("actor"), "customers.create");
    const body = await c.req.json<{ rows: Record<string, string>[] }>();
    return jsonSuccess(await previewCustomerImport(body.rows), c.get("requestId"));
  });
  api.post("/imports/customers/commit", async (c) => {
    const body = await c.req.json<{ rows: Record<string, string>[]; importId?: string }>();
    return jsonSuccess(
      await commitCustomerImport(c.env.DB, c.get("actor"), body, c.get("requestId")),
      c.get("requestId"),
    );
  });

  api.get("/custom-fields", async (c) => {
    const targetEntity = c.req.query("targetEntity");
    if (targetEntity) {
      return jsonSuccess(await listAvailableCustomFieldDefinitions(c.env.DB, c.get("actor"), targetEntity), c.get("requestId"));
    }
    requirePermission(c.get("actor"), "settings.manage");
    return jsonSuccess(await listCustomFieldDefinitions(c.env.DB), c.get("requestId"));
  });
  api.post("/custom-fields", async (c) => {
    return jsonSuccess(await createCustomFieldDefinition(c.env.DB, c.get("actor"), await c.req.json(), c.get("requestId")), c.get("requestId"), {}, 201);
  });
  api.patch("/custom-fields/:id", async (c) => {
    await updateCustomFieldDefinition(c.env.DB, c.get("actor"), c.req.param("id"), await c.req.json(), c.get("requestId"));
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });

  api.get("/activity", async (c) => {
    requirePermission(c.get("actor"), "audit.view");
    const rows = await all(c.env.DB, "SELECT id, actor_id, entity_type, entity_id, action, created_at FROM audit_log ORDER BY created_at DESC LIMIT 200");
    return jsonSuccess(rows, c.get("requestId"));
  });
}
