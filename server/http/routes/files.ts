import type { Hono } from "hono";
import { one } from "../../db/sql";
import { requirePermission } from "../../services/actor";
import { abortUpload, authorizeObjectKey, completeUpload, createUploadSession, downloadObject, signPart, storeLocalPart } from "../../services/uploads";
import { errors, jsonSuccess } from "../errors";
import type { AppEnv } from "../types";

const KNOWN_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);
const TYPE_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

function extensionOf(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

export function downloadContentType(objectType: string | undefined, storedType: string | null | undefined, filename: string) {
  const generic = !objectType || objectType === "application/octet-stream" || objectType === "binary/octet-stream";
  if (storedType && KNOWN_TYPES.has(storedType)) return storedType;
  const fromName = TYPE_BY_EXTENSION[extensionOf(filename)];
  if (fromName) return fromName;
  if (!generic && objectType && KNOWN_TYPES.has(objectType)) return objectType;
  return "application/octet-stream";
}

export function downloadFilename(name: string, storedType: string | null | undefined) {
  const type = storedType && KNOWN_TYPES.has(storedType) ? storedType : TYPE_BY_EXTENSION[extensionOf(name)];
  const extension = type === "application/pdf" ? "pdf" : type === "image/jpeg" ? "jpg" : type === "image/png" ? "png" : "";
  if (!extension) return name || "document";
  const lower = name.toLowerCase();
  if (lower.endsWith(`.${extension}`) || (extension === "jpg" && lower.endsWith(".jpeg"))) return name;
  return `${name || "document"}.${extension}`;
}

export function mountFileRoutes(api: Hono<AppEnv>) {
  api.post("/files/uploads", async (c) => jsonSuccess(await createUploadSession(c.env.DB, c.env, c.env.DOCUMENTS, c.get("actor"), await c.req.json()), c.get("requestId"), {}, 201));
  api.post("/files/uploads/:id/sign", async (c) => {
    const body = await c.req.json<{ partNumber: number }>();
    return jsonSuccess(await signPart(c.env.DB, c.env, c.get("actor"), c.req.param("id"), body.partNumber), c.get("requestId"));
  });
  api.put("/files/uploads/:id/parts/:part", async (c) => {
    const body = await c.req.arrayBuffer();
    return jsonSuccess(await storeLocalPart(c.env.DB, c.env.DOCUMENTS, c.get("actor"), c.req.param("id"), Number(c.req.param("part")), body), c.get("requestId"));
  });
  api.post("/files/uploads/:id/complete", async (c) => jsonSuccess(await completeUpload(c.env.DB, c.env.DOCUMENTS, c.get("actor"), c.req.param("id"), (await c.req.json<{ parts: { partNumber: number; etag: string }[] }>()).parts), c.get("requestId")));
  api.post("/files/uploads/:id/abort", async (c) => {
    await abortUpload(c.env.DB, c.env.DOCUMENTS, c.get("actor"), c.req.param("id"));
    return jsonSuccess({ ok: true }, c.get("requestId"));
  });
  api.get("/files/download", async (c) => {
    requirePermission(c.get("actor"), "documents.view");
    const key = c.req.query("key");
    if (!key) throw errors.badRequest("key is required");
    await authorizeObjectKey(c.env.DB, c.get("actor"), key);
    const version = await one<{ original_name: string; content_type: string }>(
      c.env.DB,
      "SELECT original_name, content_type FROM document_versions WHERE r2_key = ? ORDER BY created_at DESC LIMIT 1",
      key,
    );
    const attachment = version
      ? null
      : await one<{ original_name: string }>(c.env.DB, "SELECT original_name FROM booking_attachments WHERE r2_key = ?", key);
    const session = version
      ? null
      : await one<{ filename: string; mime: string }>(
          c.env.DB,
          "SELECT filename, mime FROM upload_sessions WHERE object_key = ? AND state = 'COMPLETED' ORDER BY created_at DESC LIMIT 1",
          key,
        );
    const object = await downloadObject(c.env.DOCUMENTS, key);
    const filename = downloadFilename(version?.original_name || attachment?.original_name || session?.filename || "document", version?.content_type || session?.mime);
    const contentType = downloadContentType(object.httpMetadata?.contentType, version?.content_type || session?.mime, filename);
    const inlineRequested = c.req.query("inline") === "1";
    const canInline = inlineRequested && (contentType === "application/pdf" || contentType.startsWith("image/"));
    const asciiName = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
    return new Response(object.body, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `${canInline ? "inline" : "attachment"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
