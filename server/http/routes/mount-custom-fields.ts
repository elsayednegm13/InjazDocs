import type { Hono } from "hono";
import type { CustomFieldTarget } from "../../../shared/enums";
import { one } from "../../db/sql";
import { assertInvoiceMutable } from "../../services/cases";
import { assertCustomFieldEntityAccess, entityRequiresCustomFields, readCustomFields, saveCustomFields } from "../../services/custom-fields";
import { jsonSuccess } from "../errors";
import type { AppEnv } from "../types";

export function mountCustomFields(api: Hono<AppEnv>, prefix: string, target: CustomFieldTarget) {
  api.get(`${prefix}/custom-fields`, async (c) => {
    const id = c.req.param("id") ?? "";
    await assertCustomFieldEntityAccess(c.env.DB, c.get("actor"), target, id, "view");
    return jsonSuccess(await readCustomFields(c.env.DB, c.get("actor"), target, id), c.get("requestId"));
  });
  api.put(`${prefix}/custom-fields`, async (c) => {
    const id = c.req.param("id") ?? "";
    await assertCustomFieldEntityAccess(c.env.DB, c.get("actor"), target, id, "edit");
    if (target === "INVOICE") {
      const parent = await one<{ case_id: string; edit_open: number }>(c.env.DB, "SELECT case_id, edit_open FROM export_invoices WHERE id = ?", id);
      if (parent) await assertInvoiceMutable(c.env.DB, c.get("actor"), parent.case_id, parent.edit_open);
    }
    const enforceRequired = await entityRequiresCustomFields(c.env.DB, target, id);
    await saveCustomFields(c.env.DB, c.get("actor"), target, id, await c.req.json<Record<string, unknown>>(), {
      enforceRequired,
      requestId: c.get("requestId"),
    });
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });
}
