import { all, newId, nowIso, one } from "../db/sql";
import { edgeCache } from "../lib/cache";

const PRESETS = [
  ["Blanket 2.4KG (1 ply)", "1 ply", 2400],
  ["Blanket 2.7KG (1 ply)", "1 ply", 2700],
  ["Blanket 3KG (1 ply)", "1 ply", 3000],
  ["Blanket 3.7KG (1 ply)", "1 ply", 3700],
  ["Blanket 4KG (1 ply)", "1 ply", 4000],
  ["Blanket 5.7KG (1 ply)", "1 ply", 5700],
  ["Blanket 6KG (2 ply)", "2 ply", 6000],
] as const;

const DEFAULTS_TTL_MS = 10 * 60_000;
const CATALOG_TTL_MS = 5 * 60_000;

export async function ensureTradeDefaults(db: D1Database) {
  await edgeCache.getOrLoad(
    db,
    "trade:defaults_seeded",
    async () => {
      const now = nowIso();
      const [identityRes, bankRes, methodsRes, presetsRes] = await db.batch([
        db.prepare("SELECT id FROM exporter_identity WHERE id = 'default'"),
        db.prepare("SELECT COUNT(*) AS n FROM exporter_bank_accounts"),
        db.prepare("SELECT COUNT(*) AS n FROM shipping_methods"),
        db.prepare("SELECT COUNT(*) AS n FROM product_presets"),
      ]);
      const identity = identityRes.results?.[0];
      if (!identity) {
        await db
          .prepare(
            `INSERT INTO exporter_identity
               (id, name_en, name_ar, address, tax_card, tax_file, commercial_registry, phone, email, updated_at)
             VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            "NANA SECRET COMPANY",
            "نانا سيكريت",
            "BLOCK 8, EL SHERIF SECTION INDUSTRY AREA A3, 10TH OF RAMADAN CITY-EGYPT",
            "535-629-524",
            "014-5-01003-221-00-00",
            "6802 ISMAILIA INVESTMENT",
            "00201033310004",
            "SAFAA.HASSAN@NANASECRET.COM.EG",
            now,
          )
          .run();
      }
      const bank = bankRes.results?.[0] as { n: number } | undefined;
      if (!bank || Number(bank.n) === 0) {
        await db
          .prepare(
            `INSERT INTO exporter_bank_accounts
               (id, account_name, iban, bank_name, bank_address, swift_code, currency, is_default, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 'USD', 1, ?, ?)`,
          )
          .bind(
            newId(),
            "NANA SECRET COMPANY",
            "EG310002017401740120000000966",
            "BANK MISR",
            "JORDAN DISTRICT - BANK AREA - 10TH OF RAMADAN CITY - ELSHARKYA - EGYPT",
            "BMISEGCXXXX",
            now,
            now,
          )
          .run();
      }
      const methods = methodsRes.results?.[0] as { n: number } | undefined;
      if (!methods || Number(methods.n) === 0) {
        const seed: Array<[string, number]> = [
          ["FOB", 0],
          ["CFR", 1],
          ["C&F", 1],
          ["CIF", 1],
          ["EXW", 0],
        ];
        await db.batch(
          seed.map(([code, freight], index) =>
            db
              .prepare(
                `INSERT INTO shipping_methods (id, code, label, includes_freight, sort_order, active, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
              )
              .bind(newId(), code, code, freight, index + 1, now, now),
          ),
        );
      }
      const presets = presetsRes.results?.[0] as { n: number } | undefined;
      if (!presets || Number(presets.n) === 0) {
        await db.batch(
          PRESETS.map(([name, ply, netGrams]) =>
            db
              .prepare(
                `INSERT INTO product_presets
                   (id, name, description_template, ply, material, size_label, barcode, hs_code, unit_label, default_price_minor,
                    piece_weight_grams, unit_net_weight_grams, bag_weight_grams, poster_weight_grams, other_accessory_weight_grams, active, created_at, updated_at)
                 VALUES (?, ?, ?, ?, '100% POLYESTER', '180-230 / 200-240', '6223010920876', 'HS6301400010', 'Piece', 0, ?, ?, 0, 0, 0, 1, ?, ?)`,
              )
              .bind(newId(), name, `${name}\n100% POLYESTER\nSIZE 180-230 / 200-240\nBARCODE 6223010920876 / 6223010920814`, ply, netGrams, netGrams, now, now),
          ),
        );
      }
      return true;
    },
    DEFAULTS_TTL_MS,
  );
}

export async function shippingIncludesFreight(db: D1Database, label: string) {
  const key = label.trim();
  if (!key) return false;
  const rows = (await listShippingMethodRows(db)) as Array<{
    code?: string;
    label?: string;
    includes_freight?: number;
  }>;
  const lower = key.toLowerCase();
  const matched = rows.find(
    (r) => String(r.code ?? "").toLowerCase() === lower || String(r.label ?? "").toLowerCase() === lower,
  );
  if (matched) return Number(matched.includes_freight) === 1;
  const row = await one<{ includes_freight: number }>(
    db,
    `SELECT includes_freight FROM shipping_methods
     WHERE active = 1 AND (code = ? COLLATE NOCASE OR label = ? COLLATE NOCASE)
     LIMIT 1`,
    key,
    key,
  );
  if (row) return Number(row.includes_freight) === 1;
  const upper = key.toUpperCase();
  return upper.includes("CFR") || upper.includes("C&F") || upper.includes("CIF");
}

export async function listShippingMethodRows(db: D1Database) {
  return edgeCache.getOrLoad(
    db,
    "catalog:shipping_methods",
    () => all(db, "SELECT * FROM shipping_methods WHERE active = 1 ORDER BY sort_order, code"),
    CATALOG_TTL_MS,
  );
}
