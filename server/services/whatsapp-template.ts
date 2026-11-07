import { DEFAULT_WHATSAPP_TEMPLATE, normalizeWhatsAppTemplate } from "../../shared/whatsapp-template";
import { nowIso, one } from "../db/sql";
import { errors } from "../http/errors";
import type { Actor } from "./actor";
import { requirePermission } from "./actor";
import { writeAudit } from "./audit";

export type WhatsAppTemplateStatus = {
  template: string;
  customized: boolean;
  storageReady: boolean;
};

export async function readWhatsAppTemplate(db: D1Database): Promise<WhatsAppTemplateStatus> {
  const row = await readStoredTemplate(db);
  return {
    template: row.stored ?? DEFAULT_WHATSAPP_TEMPLATE,
    customized: row.stored !== null,
    storageReady: row.storageReady,
  };
}

export async function saveWhatsAppTemplate(db: D1Database, actor: Actor, input: { template?: unknown }, requestId: string) {
  requirePermission(actor, "settings.manage");
  const current = await readStoredTemplate(db);
  if (!current.storageReady) {
    throw errors.coded(
      503,
      "SCHEMA_UPGRADE_REQUIRED",
      "This deployment is waiting for a database upgrade. No change was saved.",
    );
  }
  if (typeof input.template !== "string") {
    throw errors.validation("Enter the WhatsApp message.", { template: "Enter the WhatsApp message." });
  }
  const normalized = normalizeWhatsAppTemplate(input.template);
  if ("error" in normalized) {
    const message =
      normalized.error === "too_long"
        ? "Keep the WhatsApp message within 800 characters."
        : "WhatsApp messages are plain text. Remove < and >.";
    throw errors.validation(message, { template: message });
  }
  const updatedAt = nowIso();
  await db
    .prepare("UPDATE company_settings SET whatsapp_template = ?, updated_at = ? WHERE id = 'default'")
    .bind(normalized.store, updatedAt)
    .run();
  await writeAudit(db, {
    actorId: actor.id,
    entityType: "company_settings",
    entityId: "default",
    action: "whatsapp_template.update",
    before: { customized: current.stored !== null },
    after: { customized: normalized.store !== null, length: normalized.store?.length ?? 0 },
    requestId,
  });
  return readWhatsAppTemplate(db);
}

async function readStoredTemplate(db: D1Database): Promise<{ stored: string | null; storageReady: boolean }> {
  try {
    const row = await one<{ whatsapp_template: string | null }>(
      db,
      "SELECT whatsapp_template FROM company_settings WHERE id = 'default'",
    );
    const stored = row?.whatsapp_template?.replace(/\r\n/g, "\n") ?? "";
    return { stored: stored.trim() ? stored : null, storageReady: true };
  } catch (error) {
    if (isMissingWhatsAppColumn(error)) return { stored: null, storageReady: false };
    throw error;
  }
}

function isMissingWhatsAppColumn(error: unknown) {
  const text = error instanceof Error ? `${error.message} ${String(error.cause ?? "")}` : String(error);
  return /no such column/i.test(text) && /whatsapp_template/i.test(text);
}
