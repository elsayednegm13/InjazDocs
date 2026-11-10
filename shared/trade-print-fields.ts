export type PrintFieldSide = "buyer" | "meta";
export type PrintFieldSource = "profile" | "custom";

export type PrintField = {
  id: string;
  side: PrintFieldSide;
  source: PrintFieldSource;
  key: string;
  label: string;
  visible: boolean;
  value?: string;
};

export type CustomerPrintProfile = {
  name: string;
  address: string;
  taxId: string;
  phone: string;
  email: string;
  bankName: string;
  accountName: string;
  accountLast4: string;
  ibanLast4: string;
  swift: string;
  code: string;
  country: string;
};

export type PrintDocumentValues = {
  date: string;
  invoiceNumber: string;
  reference: string;
};

export function defaultPrintFields(): PrintField[] {
  return [
    { id: "name", side: "buyer", source: "profile", key: "name", label: "BILL TO", visible: true },
    { id: "address", side: "buyer", source: "profile", key: "address", label: "ADDRESS", visible: true },
    { id: "taxId", side: "buyer", source: "profile", key: "taxId", label: "Registration number", visible: true },
    { id: "phone", side: "buyer", source: "profile", key: "phone", label: "TEL", visible: false },
    { id: "email", side: "buyer", source: "profile", key: "email", label: "EMAIL", visible: false },
    { id: "bankName", side: "buyer", source: "profile", key: "bankName", label: "BANK", visible: true },
    { id: "accountName", side: "buyer", source: "profile", key: "accountName", label: "ACCOUNT NAME", visible: true },
    { id: "accountLast4", side: "buyer", source: "profile", key: "accountLast4", label: "ACCOUNT NO", visible: true },
    { id: "ibanLast4", side: "buyer", source: "profile", key: "ibanLast4", label: "IBAN", visible: true },
    { id: "swift", side: "buyer", source: "profile", key: "swift", label: "SWIFT", visible: true },
    { id: "date", side: "meta", source: "profile", key: "date", label: "DATE", visible: true },
    { id: "invoiceNumber", side: "meta", source: "profile", key: "invoiceNumber", label: "INVOICE NO#", visible: true },
    { id: "reference", side: "meta", source: "profile", key: "reference", label: "REFERENCE", visible: false },
  ];
}

export function parsePrintFields(raw: unknown): PrintField[] | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    return normalizePrintFields(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function normalizePrintFields(raw: unknown): PrintField[] {
  if (!Array.isArray(raw)) return defaultPrintFields();
  const fields: PrintField[] = [];
  for (const item of raw.slice(0, 40)) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const side = row.side === "meta" ? "meta" : row.side === "buyer" ? "buyer" : null;
    const source = row.source === "custom" ? "custom" : row.source === "profile" ? "profile" : null;
    const label = typeof row.label === "string" ? row.label.trim().slice(0, 40) : "";
    const key = typeof row.key === "string" ? row.key.trim().slice(0, 40) : "";
    const id = typeof row.id === "string" ? row.id.trim().slice(0, 80) : "";
    if (!side || !source || !label || !key || !id) continue;
    fields.push({
      id,
      side,
      source,
      key,
      label,
      visible: row.visible !== false,
      value: typeof row.value === "string" ? row.value.slice(0, 200) : "",
    });
  }
  return fields.length ? fields : defaultPrintFields();
}

export function profileFieldValue(profile: CustomerPrintProfile, key: string, document: PrintDocumentValues) {
  if (key === "name") return profile.name;
  if (key === "address") return profile.address;
  if (key === "taxId") return profile.taxId;
  if (key === "phone") return profile.phone;
  if (key === "email") return profile.email;
  if (key === "bankName") return profile.bankName;
  if (key === "accountName") return profile.accountName;
  if (key === "accountLast4" || key === "accountNumber") return profile.accountLast4;
  if (key === "ibanLast4" || key === "iban") return profile.ibanLast4;
  if (key === "swift") return profile.swift;
  if (key === "date") return document.date;
  if (key === "invoiceNumber") return document.invoiceNumber;
  if (key === "reference") return document.reference;
  return "";
}

export function printedFieldValue(field: PrintField, profile: CustomerPrintProfile, document: PrintDocumentValues) {
  const typed = (field.value ?? "").trim();
  if (field.source === "custom" || typed) return typed;
  return profileFieldValue(profile, field.key, document).trim();
}

export function resolvePrintRows(
  fields: PrintField[] | null,
  profile: CustomerPrintProfile,
  document: PrintDocumentValues,
) {
  const source = fields ?? defaultPrintFields();
  const rows = source
    .filter((field) => field.visible)
    .map((field) => ({
      label: field.label,
      value: printedFieldValue(field, profile, document),
      side: field.side,
    }))
    .filter((row) => row.value.length > 0);
  return {
    buyer: rows.filter((row) => row.side === "buyer").map(({ label, value }) => ({ label, value })),
    meta: rows.filter((row) => row.side === "meta").map(({ label, value }) => ({ label, value })),
  };
}
