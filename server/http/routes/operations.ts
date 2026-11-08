import type { Hono } from "hono";
import { bankPresentationCheck, transitionBank, createCourier, listCourier, transitionDirect, updateCourierStatus } from "../../services/bank-courier";
import {
  addContainerSlots,
  assignContainerNumber,
  attachBookingConfirmation,
  createBooking,
  getBooking,
  linkBookingToCase,
  listBookings,
  listContainers,
  listSchedule,
  transitionContainer,
  updateBooking,
} from "../../services/bookings";
import {
  addRequirement,
  attachVersion,
  listDocumentTypes,
  listTemplates,
  removeRequirement,
  restorePreviousDocument,
  reviewDocument,
} from "../../services/documents";
import { requirePermission } from "../../services/actor";
import {
  listNotifications,
  listReminders,
  listRules,
  markNotificationRead,
  snoozeReminder,
  updateRule,
} from "../../services/reminders";
import { createTrackingLink, listTrackingLinks, publicTracking, revokeTrackingLink, rotateTrackingLink } from "../../services/tracking";
import { decideCustomerFile, deleteUnreviewedVersion, hideApprovedFileFromCustomer, openPublishedCustomerFile, publishedCustomerFilesForToken, reopenCustomerRevision, setCustomerFileShare } from "../../services/customer-files";
import { downloadContentType, downloadFilename } from "./files";
import { rateLimitSubject } from "../client-ip";
import { errors, jsonError, jsonSuccess } from "../errors";
import type { AppEnv } from "../types";
import { mountCustomFields } from "./mount-custom-fields";

/** Unauthenticated public tracking. It must not pass through the session gate. */
export function mountPublicTracking(app: Hono<AppEnv>) {
  app.get("/api/v1/public/track/:token", async (c) => {
    try {
      const data = await publicTracking(c.env.DB, c.env, c.req.param("token"), rateLimitSubject(c.req.raw, c.env));
      const customerFiles = await publishedCustomerFilesForToken(c.env.DB, c.req.param("token"));
      return jsonSuccess({ ...data, customerFiles }, c.get("requestId"));
    } catch (error) {
      return jsonError(error instanceof Error ? error : new Error("unavailable"), c.get("requestId"));
    }
  });
  app.get("/api/v1/public/track/:token/files/:versionId", async (c) => {
    try {
      const file = await openPublishedCustomerFile(
        c.env.DB,
        c.env.DOCUMENTS,
        c.req.param("token"),
        c.req.param("versionId"),
        rateLimitSubject(c.req.raw, c.env),
      );
      const filename = downloadFilename(file.filename, file.contentType);
      const contentType = downloadContentType(file.objectType, file.contentType, filename);
      const inline = c.req.query("inline") === "1" && (contentType === "application/pdf" || contentType.startsWith("image/"));
      const asciiName = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
      return new Response(file.body, {
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      return jsonError(error instanceof Error ? error : new Error("unavailable"), c.get("requestId"));
    }
  });
  app.post("/api/v1/public/track/:token/files/:versionId/decision", async (c) => {
    try {
      const origin = c.req.header("origin");
      if (!origin || origin !== c.env.BETTER_AUTH_URL) throw errors.forbidden("Origin mismatch");
      const body = await c.req.json<{ decision?: unknown; comment?: unknown }>();
      const result = await decideCustomerFile(
        c.env.DB,
        c.req.param("token"),
        c.req.param("versionId"),
        body,
        rateLimitSubject(c.req.raw, c.env),
      );
      return jsonSuccess(result, c.get("requestId"));
    } catch (error) {
      return jsonError(error instanceof Error ? error : new Error("unavailable"), c.get("requestId"));
    }
  });
}

export function mountOperationRoutes(api: Hono<AppEnv>) {
  mountCustomFields(api, "/bookings/:id", "BOOKING");
  mountCustomFields(api, "/containers/:id", "CONTAINER");

  api.get("/document-types", async (c) => jsonSuccess(await listDocumentTypes(c.env.DB), c.get("requestId")));
  api.get("/document-templates", async (c) => jsonSuccess(await listTemplates(c.env.DB), c.get("requestId")));
  api.post("/export-cases/:id/document-requirements", async (c) => jsonSuccess(await addRequirement(c.env.DB, c.get("actor"), c.env, c.req.param("id"), await c.req.json(), c.get("requestId")), c.get("requestId"), {}, 201));
  api.delete("/document-requirements/:id", async (c) => {
    await removeRequirement(c.env.DB, c.get("actor"), c.env, c.req.param("id"), c.get("requestId"));
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });
  api.post("/document-requirements/:id/versions", async (c) => jsonSuccess(await attachVersion(c.env.DB, c.get("actor"), c.env, c.req.param("id"), await c.req.json(), c.get("requestId")), c.get("requestId"), {}, 201));
  api.post("/export-cases/:id/document-requirements/:documentId/restore", async (c) => jsonSuccess(await restorePreviousDocument(c.env.DB, c.get("actor"), c.req.param("id"), c.req.param("documentId"), c.get("requestId")), c.get("requestId")));
  api.post("/document-requirements/:id/review", async (c) => {
    await reviewDocument(c.env.DB, c.get("actor"), c.env, c.req.param("id"), await c.req.json(), c.get("requestId"));
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });
  api.post("/document-requirements/:id/hide-from-customer", async (c) => jsonSuccess(await hideApprovedFileFromCustomer(c.env.DB, c.get("actor"), c.env, c.req.param("id"), c.get("requestId")), c.get("requestId")));
  api.post("/document-versions/:id/customer-revision", async (c) => jsonSuccess(await reopenCustomerRevision(c.env.DB, c.get("actor"), c.req.param("id"), c.get("requestId")), c.get("requestId")));
  api.post("/document-versions/:id/customer-share", async (c) => {
    const body = await c.req.json<{ publish?: boolean }>();
    return jsonSuccess(await setCustomerFileShare(c.env.DB, c.get("actor"), c.req.param("id"), body.publish === true, c.get("requestId")), c.get("requestId"));
  });
  api.delete("/document-versions/:id", async (c) => jsonSuccess(await deleteUnreviewedVersion(c.env.DB, c.env.DOCUMENTS, c.get("actor"), c.env, c.req.param("id"), c.get("requestId")), c.get("requestId")));

  api.get("/export-cases/:id/bank/presentation-check", async (c) => {
    return jsonSuccess({ discrepancies: await bankPresentationCheck(c.env.DB, c.get("actor"), c.req.param("id")) }, c.get("requestId"));
  });
  api.post("/export-cases/:id/bank/status", async (c) => {
    const body = await c.req.json<{ to: never; bankName?: string; reason?: string }>();
    await transitionBank(c.env.DB, c.get("actor"), c.env, c.req.param("id"), body.to, body, c.get("requestId"));
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });
  api.post("/export-cases/:id/direct/status", async (c) => {
    const body = await c.req.json<{ to: never }>();
    await transitionDirect(c.env.DB, c.get("actor"), c.env, c.req.param("id"), body.to, c.get("requestId"));
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });
  api.get("/export-cases/:id/courier", async (c) => jsonSuccess(await listCourier(c.env.DB, c.get("actor"), c.req.param("id")), c.get("requestId")));
  api.post("/export-cases/:id/courier", async (c) => jsonSuccess(await createCourier(c.env.DB, c.get("actor"), c.env, c.req.param("id"), await c.req.json(), c.get("requestId")), c.get("requestId"), {}, 201));
  api.post("/courier/:id/status", async (c) => {
    await updateCourierStatus(c.env.DB, c.get("actor"), c.env, c.req.param("id"), await c.req.json(), c.get("requestId"));
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });

  api.get("/bookings", async (c) => {
    const pageSize = c.req.query("pageSize");
    const result = await listBookings(c.env.DB, c.get("actor"), {
      page: Number(c.req.query("page") ?? 1),
      pageSize: pageSize ? Number(pageSize) : undefined,
      q: c.req.query("q") ?? undefined,
      unlinked: c.req.query("unlinked") === "1",
    });
    return jsonSuccess(result.rows, c.get("requestId"), { page: result.page, pageSize: result.pageSize });
  });
  api.post("/bookings", async (c) => jsonSuccess(await createBooking(c.env.DB, c.get("actor"), c.env, await c.req.json(), c.get("requestId")), c.get("requestId"), {}, 201));
  api.get("/bookings/:id", async (c) => jsonSuccess(await getBooking(c.env.DB, c.get("actor"), c.req.param("id")), c.get("requestId")));
  api.put("/bookings/:id", async (c) => {
    await updateBooking(c.env.DB, c.get("actor"), c.env, c.req.param("id"), await c.req.json(), c.get("requestId"));
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });
  api.post("/bookings/:id/link", async (c) => {
    await linkBookingToCase(c.env.DB, c.get("actor"), c.env, c.req.param("id"), await c.req.json(), c.get("requestId"));
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });
  api.post("/bookings/:id/confirmation", async (c) => jsonSuccess(await attachBookingConfirmation(c.env.DB, c.get("actor"), c.req.param("id"), await c.req.json(), c.get("requestId")), c.get("requestId"), {}, 201));
  api.post("/bookings/:id/slots", async (c) => {
    const body = await c.req.json<{ count: number }>();
    await addContainerSlots(c.env.DB, c.get("actor"), c.req.param("id"), body.count);
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });
  api.post("/containers/:id/number", async (c) => {
    await assignContainerNumber(c.env.DB, c.get("actor"), c.env, c.req.param("id"), await c.req.json(), c.get("requestId"));
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });
  api.post("/containers/:id/status", async (c) => {
    await transitionContainer(c.env.DB, c.get("actor"), c.env, c.req.param("id"), await c.req.json(), c.get("requestId"));
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });
  api.get("/containers", async (c) => jsonSuccess(await listContainers(c.env.DB, c.get("actor"), { q: c.req.query("q") ?? undefined, status: c.req.query("status") ?? undefined }), c.get("requestId")));
  api.get("/schedule", async (c) => jsonSuccess(await listSchedule(c.env.DB, c.get("actor"), { from: c.req.query("from") ?? undefined, to: c.req.query("to") ?? undefined }), c.get("requestId")));

  api.get("/reminders", async (c) => jsonSuccess(await listReminders(c.env.DB, c.get("actor"), c.req.query("filter") ?? "open"), c.get("requestId")));
  api.post("/reminders/:id/snooze", async (c) => {
    const body = await c.req.json<{ until: string }>();
    await snoozeReminder(c.env.DB, c.get("actor"), c.req.param("id"), body.until);
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });
  api.get("/notifications", async (c) => jsonSuccess(await listNotifications(c.env.DB, c.get("actor")), c.get("requestId")));
  api.post("/notifications/:id/read", async (c) => {
    await markNotificationRead(c.env.DB, c.get("actor"), c.req.param("id"));
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });
  api.get("/reminder-rules", async (c) => {
    requirePermission(c.get("actor"), "reminders.manage_rules");
    return jsonSuccess(await listRules(c.env.DB), c.get("requestId"));
  });
  api.patch("/reminder-rules/:id", async (c) => {
    const testFaults = c.env.EXPORTFLOW_TEST_FAULTS === "1"
      || c.env.EXPORTFLOW_FIXTURE === "cp0654"
      || c.env.EXPORTFLOW_FIXTURE === "cp0654b";
    const faultHeader = testFaults ? c.req.header("x-exportflow-fault") : null;
    await updateRule(c.env.DB, c.get("actor"), c.env, c.req.param("id"), await c.req.json(), faultHeader);
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });

  api.get("/export-cases/:id/tracking-links", async (c) => jsonSuccess(await listTrackingLinks(c.env.DB, c.get("actor"), c.req.param("id")), c.get("requestId")));
  api.post("/export-cases/:id/tracking-links", async (c) => jsonSuccess(await createTrackingLink(c.env.DB, c.get("actor"), c.req.param("id"), await c.req.json(), c.get("requestId")), c.get("requestId"), {}, 201));
  api.post("/tracking-links/:id/revoke", async (c) => {
    await revokeTrackingLink(c.env.DB, c.get("actor"), c.req.param("id"), c.get("requestId"));
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });
  api.post("/tracking-links/:id/rotate", async (c) => jsonSuccess(await rotateTrackingLink(c.env.DB, c.get("actor"), c.req.param("id"), c.get("requestId")), c.get("requestId")));
}
