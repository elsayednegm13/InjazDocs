import type { Hono } from "hono";
import { readBrandFavicon, readBrandLogo, readBrandStatus, saveBrand } from "../../services/brand";
import { readWhatsAppTemplate, saveWhatsAppTemplate } from "../../services/whatsapp-template";
import { errors, jsonSuccess, securityHeaders } from "../errors";
import type { AppEnv } from "../types";

export function mountPublicBrand(app: Hono<AppEnv>) {
  app.get("/api/v1/public/brand", async (c) => jsonSuccess(await readBrandStatus(c.env.DB), c.get("requestId")));
  app.get("/api/v1/public/brand/logo", async (c) => imageResponse(await readBrandLogo(c.env.DB), "No company logo"));
  app.get("/api/v1/public/brand/favicon", async (c) => imageResponse(await readBrandFavicon(c.env.DB), "No favicon"));
}

function imageResponse(image: { mime: string; bytes: Uint8Array } | null, missing: string) {
  if (!image) throw errors.notFound(missing);
  return new Response(image.bytes, {
    headers: {
      ...securityHeaders(),
      "content-type": image.mime,
      "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
}

export function mountBrandRoutes(api: Hono<AppEnv>) {
  api.get("/settings/brand", async (c) => jsonSuccess(await readBrandStatus(c.env.DB), c.get("requestId")));
  api.post("/settings/brand", async (c) => {
    const body = await c.req.json<{
      productName?: string;
      theme?: string;
      logoData?: string;
      clearLogo?: boolean;
      faviconData?: string;
      clearFavicon?: boolean;
    }>();
    return jsonSuccess(await saveBrand(c.env.DB, c.get("actor"), body, c.get("requestId")), c.get("requestId"));
  });
  api.get("/settings/whatsapp-template", async (c) => jsonSuccess(await readWhatsAppTemplate(c.env.DB), c.get("requestId")));
  api.post("/settings/whatsapp-template", async (c) => {
    const body = await c.req.json<{ template?: unknown }>();
    return jsonSuccess(await saveWhatsAppTemplate(c.env.DB, c.get("actor"), body, c.get("requestId")), c.get("requestId"));
  });
}
