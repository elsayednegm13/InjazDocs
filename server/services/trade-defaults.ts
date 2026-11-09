import { all, newId, nowIso, one } from "../db/sql";

const PRESETS = [
  ["Blanket 2.4KG (1 ply)", "1 ply"],
  ["Blanket 2.7KG (1 ply)", "1 ply"],
  ["Blanket 3KG (1 ply)", "1 ply"],
  ["Blanket 3.7KG (1 ply)", "1 ply"],
  ["Blanket 4KG (1 ply)", "1 ply"],
  ["Blanket 5.7KG (1 ply)", "1 ply"],
  ["Blanket 6KG (2 ply)", "2 ply"],
] as const;

export async function ensureTradeDefaults(db: D1Database) {
  const now = nowIso();
  const identity = await one(db, "SELECT id FROM exporter_identity WHERE id = 'default'");
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
  const bank = await one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM exporter_bank_accounts");
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
  const methods = await one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM shipping_methods");
  if (!methods || Number(methods.n) === 0) {
    const seed: Array<[string, number]> = [
      ["FOB", 0],
      ["CFR", 1],
      ["C&F", 1],
      ["CIF", 1],
      ["EXW", 0],
    ];
    for (const [index, [code, freight]] of seed.entries()) {
      await db
        .prepare(
          `INSERT INTO shipping_methods (id, code, label, includes_freight, sort_order, active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
        )
        .bind(newId(), code, code, freight, index + 1, now, now)
        .run();
    }
  }
  const presets = await one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM product_presets");
  if (!presets || Number(presets.n) === 0) {
    for (const [name, ply] of PRESETS) {
      await db
        .prepare(
          `INSERT INTO product_presets
             (id, name, description_template, ply, material, size_label, barcode, hs_code, unit_label, default_price_minor, active, created_at, updated_at)
           VALUES (?, ?, ?, ?, '100% POLYESTER', '180-230 / 200-240', '6223010920876', 'HS6301400010', 'Piece', 0, 1, ?, ?)`,
        )
        .bind(newId(), name, `${name}\n100% POLYESTER\nSIZE 180-230 / 200-240\nBARCODE 6223010920876 / 6223010920814`, ply, now, now)
        .run();
    }
  }
}

export async function shippingIncludesFreight(db: D1Database, label: string) {
  const key = label.trim();
  if (!key) return false;
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
  return all(db, "SELECT * FROM shipping_methods WHERE active = 1 ORDER BY sort_order, code");
}
