/**
 * Canonical customer-CSV import identity.
 *
 * The fingerprint is SHA-256 over a versioned, canonical parsed structure:
 *   - the sorted set of mapped header identities,
 *   - every row in file order,
 *   - each mapped cell normalized with the rules below.
 *
 * It is deliberately not a hash of the raw file, the filename or the client
 * operation id. Two files that differ only by row order, header mapping or
 * cell content produce different fingerprints, because row index and mapping
 * are part of the product's current resume identity.
 */
export const CUSTOMER_IMPORT_PARSER_VERSION = "csv-v1";

export function normalizeImportCell(value: unknown): string {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .trim();
}

export function canonicalizeCustomerImportRows(rows: Record<string, string>[]): {
  parserVersion: string;
  headers: string[];
  rows: string[][];
  canonical: string;
} {
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))].sort();
  const normalizedRows = rows.map((row) => headers.map((header) => normalizeImportCell(row[header])));
  const canonical = JSON.stringify({
    parserVersion: CUSTOMER_IMPORT_PARSER_VERSION,
    headers,
    rows: normalizedRows,
  });
  return { parserVersion: CUSTOMER_IMPORT_PARSER_VERSION, headers, rows: normalizedRows, canonical };
}

export async function fingerprintCustomerImportRows(
  rows: Record<string, string>[],
): Promise<{ fingerprint: string; parserVersion: string; headers: string[] }> {
  const canonical = canonicalizeCustomerImportRows(rows);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical.canonical));
  const fingerprint = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return { fingerprint, parserVersion: canonical.parserVersion, headers: canonical.headers };
}
