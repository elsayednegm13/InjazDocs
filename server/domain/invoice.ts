import { assertNonNegativeMinor } from "../../shared/money";
import { assertGrossGteNet } from "../../shared/weights";
import type { Incoterm } from "../../shared/enums";

export type InvoiceInput = {
  incoterm: Incoterm;
  goodsValueMinor: bigint | number;
  invoicedFreightMinor: bigint | number;
  actualFreightExpenseMinor: bigint | number;
  invoiceTotalMinor: bigint | number;
  currency: string;
  grossWeightGrams: number;
  netWeightGrams: number;
};

export type InvoiceValidation = {
  ok: true;
} | {
  ok: false;
  code: string;
  message: string;
};

export function validateInvoiceCommercials(input: InvoiceInput): InvoiceValidation {
  try {
    assertNonNegativeMinor(input.goodsValueMinor, "GOODS_VALUE");
    assertNonNegativeMinor(input.invoicedFreightMinor, "INVOICED_FREIGHT");
    assertNonNegativeMinor(input.actualFreightExpenseMinor, "ACTUAL_FREIGHT");
    assertNonNegativeMinor(input.invoiceTotalMinor, "INVOICE_TOTAL");
    assertGrossGteNet(input.grossWeightGrams, input.netWeightGrams);
  } catch (error) {
    const code = error instanceof Error ? error.message : "INVALID_INVOICE";
    return { ok: false, code, message: code };
  }

  if (input.incoterm === "FOB" && BigInt(input.invoicedFreightMinor) > 0n) {
    return {
      ok: false,
      code: "FOB_HAS_INVOICED_FREIGHT",
      message: "FOB invoices must not include a seller-invoiced main-ocean freight component. Record incurred shipping cost as actual freight expense instead.",
    };
  }

  return { ok: true };
}

export function derivedGoodsPlusInvoicedFreight(
  goodsValueMinor: bigint | number,
  invoicedFreightMinor: bigint | number,
): bigint {
  return BigInt(goodsValueMinor) + BigInt(invoicedFreightMinor);
}

export function invoiceTotalComparison(input: {
  invoiceTotalMinor: bigint | number;
  goodsValueMinor: bigint | number;
  invoicedFreightMinor: bigint | number;
}): { matchesGoodsPlusInvoicedFreight: boolean; derivedMinor: string } {
  const derived = derivedGoodsPlusInvoicedFreight(input.goodsValueMinor, input.invoicedFreightMinor);
  return {
    matchesGoodsPlusInvoicedFreight: derived === BigInt(input.invoiceTotalMinor),
    derivedMinor: derived.toString(),
  };
}
