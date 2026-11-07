import { describe, expect, it } from "vitest";
import {
  DEFAULT_WHATSAPP_TEMPLATE,
  insertWhatsAppToken,
  normalizeWhatsAppTemplate,
  renderWhatsAppTemplate,
  whatsAppRuns,
  wrapWhatsAppSelection,
  type WhatsAppFieldValues,
} from "../shared/whatsapp-template";

const fields: WhatsAppFieldValues = {
  customerName: "Nile Trading",
  customerCode: "C-1008",
  phone: "01000000000",
  invoiceNumber: "INV-2041",
  country: "EG",
  trackingUrl: "https://exportflow.example/track/sample",
};

describe("whatsapp template", () => {
  it("keeps today's shipment message when no custom template is stored", () => {
    expect(renderWhatsAppTemplate(DEFAULT_WHATSAPP_TEMPLATE, fields)).toBe(
      [
        "*متابعة الشحنة*",
        "",
        "*الكود*",
        "C-1008",
        "",
        "*العميل*",
        "Nile Trading",
        "",
        "*الفاتورة*",
        "INV-2041",
        "",
        "*الدولة*",
        "EG",
        "",
        "*رابط المتابعة*",
        "https://exportflow.example/track/sample",
      ].join("\n"),
    );
  });

  it("fills only the fields the template includes and leaves blanks as a dash", () => {
    expect(renderWhatsAppTemplate("Hello {{customerName}}\n{{phone}}", { ...fields, phone: "  " })).toBe("Hello Nile Trading\n—");
  });

  it("stores a custom message and treats the original text as the built-in default", () => {
    expect(normalizeWhatsAppTemplate(DEFAULT_WHATSAPP_TEMPLATE)).toEqual({ store: null });
    expect(normalizeWhatsAppTemplate("  \n")).toEqual({ store: null });
    expect(normalizeWhatsAppTemplate("Hello {{customerName}}")).toEqual({ store: "Hello {{customerName}}" });
    expect(normalizeWhatsAppTemplate("<b>Hello</b>")).toEqual({ error: "markup" });
    expect(normalizeWhatsAppTemplate("x".repeat(801))).toEqual({ error: "too_long" });
  });

  it("wraps the selection and inserts a field at the caret", () => {
    expect(wrapWhatsAppSelection("Hello", 0, 5, "*")).toEqual({ value: "*Hello*", start: 1, end: 6 });
    expect(insertWhatsAppToken("Hi ", 3, 3, "{{customerName}}")).toEqual({
      value: "Hi {{customerName}}",
      start: 19,
      end: 19,
    });
  });

  it("reads WhatsApp marks as bold, italic, strike and fixed width", () => {
    expect(whatsAppRuns("*كود* و _اسم_ و ~قديم~ و ```A1```")).toEqual([
      { kind: "bold", text: "كود" },
      { kind: "text", text: " و " },
      { kind: "italic", text: "اسم" },
      { kind: "text", text: " و " },
      { kind: "strike", text: "قديم" },
      { kind: "text", text: " و " },
      { kind: "mono", text: "A1" },
    ]);
  });
});
