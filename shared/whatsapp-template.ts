export const WHATSAPP_TEMPLATE_MAX = 800;
export const WHATSAPP_LINK_SOFT_LIMIT = 1600;

export const WHATSAPP_FIELDS = [
  "customerName",
  "customerCode",
  "phone",
  "invoiceNumber",
  "country",
  "trackingUrl",
] as const;

export type WhatsAppField = (typeof WHATSAPP_FIELDS)[number];

export type WhatsAppFieldValues = Record<WhatsAppField, string>;

export const DEFAULT_WHATSAPP_TEMPLATE = [
  "*متابعة الشحنة*",
  "",
  "*الكود*",
  "{{customerCode}}",
  "",
  "*العميل*",
  "{{customerName}}",
  "",
  "*الفاتورة*",
  "{{invoiceNumber}}",
  "",
  "*الدولة*",
  "{{country}}",
  "",
  "*رابط المتابعة*",
  "{{trackingUrl}}",
].join("\n");

const FIELD_TOKEN = /\{\{(customerName|customerCode|phone|invoiceNumber|country|trackingUrl)\}\}/g;

export function renderWhatsAppTemplate(template: string, fields: WhatsAppFieldValues) {
  const source = template.trim() ? template : DEFAULT_WHATSAPP_TEMPLATE;
  return source.replace(FIELD_TOKEN, (_match, key: WhatsAppField) => fields[key].trim() || "—");
}

export function normalizeWhatsAppTemplate(input: string): { store: string | null } | { error: "empty" | "too_long" | "markup" } {
  const text = input.replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  if (!text.trim() || text === DEFAULT_WHATSAPP_TEMPLATE) return { store: null };
  if (text.length > WHATSAPP_TEMPLATE_MAX) return { error: "too_long" };
  if (/[<>]/.test(text)) return { error: "markup" };
  return { store: text };
}

export function wrapWhatsAppSelection(value: string, start: number, end: number, marker: "*" | "_" | "~" | "```") {
  const safeStart = clamp(start, 0, value.length);
  const safeEnd = clamp(end, safeStart, value.length);
  const selected = value.slice(safeStart, safeEnd);
  return {
    value: `${value.slice(0, safeStart)}${marker}${selected}${marker}${value.slice(safeEnd)}`,
    start: safeStart + marker.length,
    end: safeStart + marker.length + selected.length,
  };
}

export function insertWhatsAppToken(value: string, start: number, end: number, token: string) {
  const safeStart = clamp(start, 0, value.length);
  const safeEnd = clamp(end, safeStart, value.length);
  const next = `${value.slice(0, safeStart)}${token}${value.slice(safeEnd)}`;
  const cursor = safeStart + token.length;
  return { value: next, start: cursor, end: cursor };
}

export type WhatsAppRun = { kind: "text" | "bold" | "italic" | "strike" | "mono"; text: string };

export function whatsAppRuns(line: string): WhatsAppRun[] {
  const runs: WhatsAppRun[] = [];
  let plain = "";
  let index = 0;
  const flush = () => {
    if (!plain) return;
    runs.push({ kind: "text", text: plain });
    plain = "";
  };
  while (index < line.length) {
    const marker = markerAt(line, index);
    if (!marker) {
      plain += line[index];
      index += 1;
      continue;
    }
    const close = line.indexOf(marker.token, index + marker.token.length);
    if (close < 0) {
      plain += line[index];
      index += 1;
      continue;
    }
    flush();
    runs.push({ kind: marker.kind, text: line.slice(index + marker.token.length, close) });
    index = close + marker.token.length;
  }
  flush();
  return runs;
}

function markerAt(line: string, index: number): { token: string; kind: WhatsAppRun["kind"] } | null {
  if (line.startsWith("```", index)) return { token: "```", kind: "mono" };
  const char = line[index];
  if (char === "*") return { token: "*", kind: "bold" };
  if (char === "_") return { token: "_", kind: "italic" };
  if (char === "~") return { token: "~", kind: "strike" };
  return null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
