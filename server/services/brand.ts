import { nowIso, one } from "../db/sql";
import { errors } from "../http/errors";
import type { Actor } from "./actor";
import { requirePermission } from "./actor";
import { writeAudit } from "./audit";

const MAX_LOGO_BYTES = 512 * 1024;
const MAX_ICON_BYTES = 256 * 1024;

export type BrandStatus = {
  name: string;
  theme: "light" | "dark";
  hasLogo: boolean;
  hasFavicon: boolean;
  updatedAt: string | null;
};

export async function readBrandStatus(db: D1Database): Promise<BrandStatus> {
  const row = await one<{
    product_name: string | null;
    theme: string | null;
    updated_at: string | null;
    has_logo: number;
    has_favicon: number;
  }>(
    db,
    `SELECT product_name, theme, updated_at,
            CASE WHEN logo_data IS NULL THEN 0 ELSE 1 END AS has_logo,
            CASE WHEN favicon_data IS NULL THEN 0 ELSE 1 END AS has_favicon
     FROM company_settings WHERE id = 'default'`,
  );
  return {
    name: row?.product_name?.trim() || "ExportFlow",
    theme: row?.theme === "dark" ? "dark" : "light",
    hasLogo: Number(row?.has_logo) === 1,
    hasFavicon: Number(row?.has_favicon) === 1,
    updatedAt: row?.updated_at ?? null,
  };
}

export async function readBrandLogo(db: D1Database): Promise<{ mime: string; bytes: Uint8Array } | null> {
  const row = await one<{ logo_mime: string | null; logo_data: unknown }>(
    db,
    "SELECT logo_mime, logo_data FROM company_settings WHERE id = 'default'",
  );
  const bytes = asBytes(row?.logo_data);
  if (!row?.logo_mime || !bytes?.byteLength) return null;
  return { mime: row.logo_mime, bytes };
}

export async function readBrandFavicon(db: D1Database): Promise<{ mime: string; bytes: Uint8Array } | null> {
  const row = await one<{ favicon_mime: string | null; favicon_data: unknown }>(
    db,
    "SELECT favicon_mime, favicon_data FROM company_settings WHERE id = 'default'",
  );
  const bytes = asBytes(row?.favicon_data);
  if (!row?.favicon_mime || !bytes?.byteLength) return null;
  return { mime: row.favicon_mime, bytes };
}

export async function saveBrand(
  db: D1Database,
  actor: Actor,
  input: {
    productName?: string;
    theme?: string;
    logoData?: string;
    clearLogo?: boolean;
    faviconData?: string;
    clearFavicon?: boolean;
  },
  requestId: string,
) {
  requirePermission(actor, "settings.manage");
  const current = await readBrandStatus(db);
  const name = input.productName === undefined ? current.name : input.productName.trim();
  if (!name || name.length > 40) throw errors.validation("Enter a system name of 40 characters or fewer.", { productName: "Enter the system name." });
  if (input.theme !== undefined && input.theme !== "light" && input.theme !== "dark") {
    throw errors.validation("Choose light or dark.", { theme: "Choose a theme." });
  }
  const theme = input.theme === "dark" ? "dark" : input.theme === "light" ? "light" : current.theme;
  const updatedAt = nowIso();
  const sets = ["product_name = ?", "theme = ?", "updated_at = ?"];
  const binds: unknown[] = [name, theme, updatedAt];
  if (input.clearLogo) {
    sets.push("logo_mime = NULL", "logo_data = NULL");
  } else if (input.logoData) {
    const bytes = decodeImage(input.logoData, MAX_LOGO_BYTES, "logo");
    const mime = imageMime(bytes);
    if (!mime || mime === "image/x-icon") throw errors.validation("Use a PNG, JPEG, WEBP or GIF logo.", { logo: "Unsupported image." });
    sets.push("logo_mime = ?", "logo_data = ?");
    binds.push(mime, bytes);
  }
  if (input.clearFavicon) {
    sets.push("favicon_mime = NULL", "favicon_data = NULL");
  } else if (input.faviconData) {
    const bytes = decodeImage(input.faviconData, MAX_ICON_BYTES, "favicon");
    const mime = imageMime(bytes);
    if (!mime) throw errors.validation("Use a PNG, JPEG, WEBP, GIF or ICO icon.", { favicon: "Unsupported image." });
    sets.push("favicon_mime = ?", "favicon_data = ?");
    binds.push(mime, bytes);
  }
  await db.prepare(`UPDATE company_settings SET ${sets.join(", ")} WHERE id = 'default'`).bind(...binds).run();
  await writeAudit(db, {
    actorId: actor.id,
    entityType: "company_settings",
    entityId: "default",
    action: "brand.update",
    after: { name, theme },
    requestId,
  });
  return readBrandStatus(db);
}

function decodeImage(value: string, maxBytes: number, field: string): Uint8Array {
  const cleaned = value.replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "");
  if (!cleaned) throw errors.validation("Choose an image.", { [field]: "Choose an image." });
  if (cleaned.length > 800_000) throw errors.payload("The image is too large.");
  let binary: string;
  try {
    binary = atob(cleaned);
  } catch {
    throw errors.validation("The logo file could not be read.", { logo: "Choose an image." });
  }
  if (binary.length > maxBytes) throw errors.payload("The image is too large.");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function imageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (bytes.length >= 4 && bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00) return "image/x-icon";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

function asBytes(value: unknown): Uint8Array | null {
  if (!value) return null;
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value) && value.every((item) => typeof item === "number")) return Uint8Array.from(value);
  return null;
}
