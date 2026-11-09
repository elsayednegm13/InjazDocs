import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { api } from "@/lib/api";
import { notifyError, notifySuccess } from "@/lib/notify";
import { useCopy } from "@/lib/copy";
import { cn } from "@/lib/utils";
import {
  downloadPdf,
  kgText,
  kgToGrams,
  lineAmount,
  liveReconciliation,
  moneyMinor,
  moneyText,
  newKey,
  type BankAccount,
  type InvoiceDraftLine,
  type PackingDraftLine,
  type ProductPreset,
} from "./trade-model";
import { CatalogDialog, CompanyDialog, PaymentTermField, saveLineToCatalog } from "./TradeDialogs";

type SheetLine = {
  description: string;
  hs_code: string | null;
  barcode: string | null;
  unit_label: string | null;
  quantity: number;
  unit_price_minor: number;
};

type SheetPack = {
  container_id: string | null;
  description: string;
  hs_code: string | null;
  packages_count: number;
  packing_per_package: number;
  gross_weight_grams: number;
  net_weight_grams: number;
};

type Sheet = {
  header: {
    trade_status: string;
    payment_term_label: string | null;
    shipping_method_label: string | null;
    origin_of_goods: string | null;
    exporter_bank_account_id: string | null;
    invoiced_freight_minor: number;
    packages_count: number;
    gross_weight_grams: number;
    net_weight_grams: number;
    currency: string;
    print_reference: string | null;
  };
  lines: SheetLine[];
  packing: SheetPack[];
};

export function TradeBuilder({
  invoiceId,
  currency,
  containers,
  canEdit,
  customerCode = "",
}: {
  invoiceId: string;
  currency: string;
  containers: Array<{ id: string; slot_index?: number; official_number?: string | null; status?: string }>;
  canEdit: boolean;
  customerCode?: string;
}) {
  const { tx } = useCopy();
  const client = useQueryClient();
  const sheet = useQuery({
    queryKey: ["trade-sheet", invoiceId],
    queryFn: async () => (await api<Sheet>(`/api/v1/invoices/${invoiceId}/trade-sheet`)).data,
  });
  const banks = useQuery({ queryKey: ["exporter-banks"], queryFn: async () => (await api<BankAccount[]>("/api/v1/settings/exporter-bank-accounts")).data });
  const presets = useQuery({ queryKey: ["product-presets"], queryFn: async () => (await api<ProductPreset[]>("/api/v1/product-presets")).data });
  const [section, setSection] = useState<"invoice" | "packing">("invoice");
  const [lines, setLines] = useState<InvoiceDraftLine[]>([]);
  const [packing, setPacking] = useState<PackingDraftLine[]>([]);
  const [paymentLabel, setPaymentLabel] = useState("");
  const [reference, setReference] = useState("");
  const [companyOpen, setCompanyOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [shippingLabel, setShippingLabel] = useState("CFR");
  const [origin, setOrigin] = useState("EGYPT");
  const [bankId, setBankId] = useState("");
  const [freight, setFreight] = useState("0.00");
  const [packages, setPackages] = useState(0);
  const [gross, setGross] = useState(0);
  const [net, setNet] = useState(0);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const issued = sheet.data?.header.trade_status === "ISSUED";
  const locked = issued || !canEdit;

  useEffect(() => {
    const data = sheet.data;
    if (!data || ready) return;
    setLines(data.lines.length ? data.lines.map(toInvoiceLine) : [blankInvoiceLine()]);
    setPacking(data.packing.length ? data.packing.map(toPackingLine) : [blankPackingLine()]);
    setPaymentLabel(data.header.payment_term_label ?? "");
    setReference(data.header.print_reference || customerCode);
    setShippingLabel(data.header.shipping_method_label ?? "CFR");
    setOrigin(data.header.origin_of_goods ?? "EGYPT");
    setBankId(data.header.exporter_bank_account_id ?? "");
    setFreight(moneyText(Number(data.header.invoiced_freight_minor ?? 0), currency));
    setPackages(Number(data.header.packages_count ?? 0));
    setGross(Number(data.header.gross_weight_grams ?? 0));
    setNet(Number(data.header.net_weight_grams ?? 0));
    setReady(true);
  }, [sheet.data, ready, currency, customerCode]);

  const summary = useMemo(
    () => liveReconciliation({ lines, packing, packages, grossGrams: gross, netGrams: net, currency }),
    [lines, packing, packages, gross, net, currency],
  );
  const fob = lines.reduce((sum, line) => sum + lineAmount(line, currency), 0);
  let freightMinor = 0;
  try {
    freightMinor = moneyMinor(freight, currency);
  } catch {
    freightMinor = 0;
  }
  const chargesFreight = /c&f|cfr/i.test(shippingLabel);

  async function saveDraft() {
    setBusy(true);
    try {
      await api(`/api/v1/invoices/${invoiceId}/trade-header`, {
        method: "PUT",
        body: JSON.stringify({
          paymentTermLabel: paymentLabel,
          shippingMethodLabel: shippingLabel,
          originOfGoods: origin,
          exporterBankAccountId: bankId || null,
          seaFreightMinor: freightMinor,
          printReference: reference,
        }),
      });
      await api(`/api/v1/invoices/${invoiceId}/lines`, { method: "PUT", body: JSON.stringify({ lines: lines.map(serializeInvoice) }) });
      const saved = await api<{ reconciliation: typeof summary }>(`/api/v1/invoices/${invoiceId}/packing-lines`, {
        method: "PUT",
        body: JSON.stringify({ lines: packing.map(serializePacking) }),
      });
      notifySuccess(saved.data.reconciliation.matched ? tx("tradeDraftSaved", "Draft saved") : tx("tradeDraftDiffers", "Draft saved. Totals still differ."));
      await client.invalidateQueries({ queryKey: ["trade-sheet", invoiceId] });
      await client.invalidateQueries({ queryKey: ["case"] });
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  }

  async function sync() {
    setBusy(true);
    try {
      await api(`/api/v1/invoices/${invoiceId}/packing-lines`, { method: "PUT", body: JSON.stringify({ lines: packing.map(serializePacking) }) });
      const next = await api<typeof summary>(`/api/v1/invoices/${invoiceId}/sync-totals`, { method: "POST", body: "{}" });
      setPackages(next.data.invoice.packages);
      setGross(next.data.invoice.grossGrams);
      setNet(next.data.invoice.netGrams);
      notifySuccess(tx("tradeSynced", "Summary copied from the packing list"));
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  }

  async function issue() {
    setBusy(true);
    try {
      await saveQuiet();
      await api(`/api/v1/invoices/${invoiceId}/issue-trade`, { method: "POST", body: "{}" });
      notifySuccess(tx("tradeIssued", "Commercial invoice and packing list issued"));
      setReady(false);
      await client.invalidateQueries({ queryKey: ["trade-sheet", invoiceId] });
      await client.invalidateQueries({ queryKey: ["case"] });
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  }

  async function saveQuiet() {
    await api(`/api/v1/invoices/${invoiceId}/trade-header`, {
      method: "PUT",
      body: JSON.stringify({ paymentTermLabel: paymentLabel, shippingMethodLabel: shippingLabel, originOfGoods: origin, exporterBankAccountId: bankId || null, seaFreightMinor: freightMinor, printReference: reference }),
    });
    await api(`/api/v1/invoices/${invoiceId}/lines`, { method: "PUT", body: JSON.stringify({ lines: lines.map(serializeInvoice) }) });
    await api(`/api/v1/invoices/${invoiceId}/packing-lines`, { method: "PUT", body: JSON.stringify({ lines: packing.map(serializePacking) }) });
  }

  function insertPreset(id: string) {
    const preset = (presets.data ?? []).find((item) => item.id === id);
    if (!preset) return;
    setLines((current) => [...current, {
      key: newKey(),
      description: [preset.description_template, preset.ply, preset.material, preset.size_label].filter(Boolean).join("\n"),
      hsCode: preset.hs_code ?? "",
      barcode: preset.barcode ?? "",
      unit: preset.unit_label ?? "PCS",
      quantity: "1",
      price: moneyText(preset.default_price_minor, currency),
    }]);
  }

  return (
    <section className="space-y-3 rounded-card border border-line bg-card p-3 shadow-card">
      <ReconciliationBar summary={summary} />
      <div className="flex justify-end">
        <Button type="button" size="sm" variant="outline" onClick={() => setCompanyOpen(true)}>{tx("tradeCompanyDialog", "Company and bank")}</Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant={section === "invoice" ? "default" : "outline"} onClick={() => setSection("invoice")}>{tx("tradeInvoiceLines", "Commercial lines")}</Button>
        <Button type="button" size="sm" variant={section === "packing" ? "default" : "outline"} onClick={() => setSection("packing")}>{tx("tradePacking", "Packing list")}</Button>
        <Button type="button" size="sm" variant="outline" disabled={locked || busy} onClick={() => void sync()}>{tx("tradeSync", "Sync summary from packing list")}</Button>
      </div>
      {section === "invoice" ? (
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Field label={tx("tradeBank", "Bank account")}>
              <Select value={bankId} disabled={locked} onChange={(event) => setBankId(event.target.value)}>
                <option value="">{tx("tradeNoBank", "No bank account")}</option>
                {(banks.data ?? []).map((bank) => <option key={bank.id} value={bank.id}>{bank.account_name}</option>)}
              </Select>
            </Field>
            <Field label={tx("printReference", "Print reference")}><Input dir="ltr" value={reference} disabled={locked} placeholder="EX-116" onChange={(event) => setReference(event.target.value)} /></Field>
            <PaymentTermField value={paymentLabel} disabled={locked} onChange={setPaymentLabel} />
            <Field label={tx("shippingMethod", "Shipping method")}>
              <Select value={shippingLabel} disabled={locked} onChange={(event) => setShippingLabel(event.target.value)}>
                <option>CFR</option><option>C&F</option><option>FOB</option>
              </Select>
            </Field>
            <Field label={tx("originOfGoods", "Origin of goods")}><Input value={origin} disabled={locked} onChange={(event) => setOrigin(event.target.value)} /></Field>
            <Field label={tx("seaFreight", "Sea freight")}><Input value={freight} dir="ltr" disabled={locked} onChange={(event) => setFreight(event.target.value)} /></Field>
          </div>
          <div className="flex flex-wrap items-end gap-2 rounded-control border border-line bg-paper p-2">
            <Field label={tx("tradeInsertPreset", "Insert from catalog")}>
              <Select value="" disabled={locked} onChange={(event) => { insertPreset(event.target.value); event.target.value = ""; }}>
                <option value="">{tx("tradeChoosePreset", "Choose an item")}</option>
                {(presets.data ?? []).map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
              </Select>
            </Field>
            <Button type="button" size="sm" variant="outline" disabled={locked} onClick={() => setCatalogOpen(true)}>{tx("tradeManageCatalog", "Manage catalog")}</Button>
          </div>
          <div className="space-y-2">
            {lines.map((line) => (
              <div key={line.key} className="grid gap-2 rounded-control border border-line p-2 md:grid-cols-6">
                <div className="md:col-span-2"><Field label={tx("description", "Description")}><Textarea className="min-h-16" value={line.description} disabled={locked} onChange={(event) => updateLine(setLines, line.key, { description: event.target.value })} /></Field></div>
                <Field label={tx("hsCode", "HS code")}><Input dir="ltr" value={line.hsCode} disabled={locked} className={line.hsCode.trim() ? "" : "border-danger"} onChange={(event) => updateLine(setLines, line.key, { hsCode: event.target.value })} /></Field>
                <Field label={tx("barcode", "Barcode")}><Input dir="ltr" value={line.barcode} disabled={locked} onChange={(event) => updateLine(setLines, line.key, { barcode: event.target.value })} /></Field>
                <Field label={tx("unit", "Unit")}><Input value={line.unit} disabled={locked} onChange={(event) => updateLine(setLines, line.key, { unit: event.target.value })} /></Field>
                <Field label={tx("quantity", "Quantity")}><Input dir="ltr" inputMode="numeric" value={line.quantity} disabled={locked} onChange={(event) => updateLine(setLines, line.key, { quantity: event.target.value })} /></Field>
                <Field label={tx("price", "Price")}><Input dir="ltr" value={line.price} disabled={locked} onChange={(event) => updateLine(setLines, line.key, { price: event.target.value })} /></Field>
                <Field label={tx("amount", "Amount")}><Input dir="ltr" readOnly value={moneyText(lineAmount(line, currency), currency)} /></Field>
                <div className="flex items-end gap-2 md:col-span-2">
                  <Button type="button" size="sm" variant="outline" disabled={locked} onClick={() => setLines((current) => [...current, { ...line, key: newKey() }])}>{tx("tradeCopyLine", "Copy line")}</Button>
                  <Button type="button" size="sm" variant="outline" disabled={locked || lines.length === 1} onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}>{tx("delete", "Delete")}</Button>
                  <Button type="button" size="sm" variant="outline" disabled={locked || !line.description.trim()} onClick={() => void saveLineToCatalog(line).then(() => { notifySuccess(tx("tradePresetSaved", "Catalog item saved")); return client.invalidateQueries({ queryKey: ["product-presets"] }); }).catch(notifyError)}>{tx("tradeSaveLineCatalog", "Save to catalog")}</Button>
                </div>
              </div>
            ))}
          </div>
          <p className="text-sm font-medium text-ink" dir="ltr">TOTAL FOB {moneyText(fob, currency)}{chargesFreight ? ` + SEA FREIGHT ${moneyText(freightMinor, currency)} = TOTAL CFR / C&F ${moneyText(fob + freightMinor, currency)}` : ""}</p>
        </div>
      ) : (
        <div className="space-y-2">
          <Button type="button" size="sm" variant="outline" disabled={locked} onClick={() => setPacking(lines.map((line) => ({ key: newKey(), containerId: "", description: line.description, hsCode: line.hsCode, packages: "1", perPackage: line.quantity || "0", grossKg: "", netKg: "" })))}>{tx("tradeDraftFromInvoice", "Draft from invoice lines")}</Button>
          {packing.map((line) => {
            const pieces = Number(line.packages) * Number(line.perPackage);
            const grossGrams = kgToGrams(line.grossKg);
            const netGrams = kgToGrams(line.netKg);
            const heavy = Number.isFinite(grossGrams) && Number.isFinite(netGrams) && netGrams > grossGrams;
            return (
              <div key={line.key} className="grid gap-2 rounded-control border border-line p-2 md:grid-cols-4">
                <Field label={tx("container", "Container")}>
                  <Select value={line.containerId} disabled={locked} onChange={(event) => updateLine(setPacking, line.key, { containerId: event.target.value })}>
                    <option value="">{tx("tradeChooseContainer", "Choose a container")}</option>
                    {containers.filter((item) => item.status !== "CANCELLED").map((item) => (
                      <option key={item.id} value={item.id}>{item.slot_index ?? ""} {item.official_number || tx("numberPending", "number pending")}</option>
                    ))}
                  </Select>
                </Field>
                <div className="md:col-span-3"><Field label={tx("description", "Description")}><Textarea className="min-h-16" value={line.description} disabled={locked} onChange={(event) => updateLine(setPacking, line.key, { description: event.target.value })} /></Field></div>
                <Field label={tx("hsCode", "HS code")}><Input dir="ltr" value={line.hsCode} disabled={locked} onChange={(event) => updateLine(setPacking, line.key, { hsCode: event.target.value })} /></Field>
                <Field label={tx("packages", "Packages")}><Input dir="ltr" inputMode="numeric" value={line.packages} disabled={locked} onChange={(event) => updateLine(setPacking, line.key, { packages: event.target.value })} /></Field>
                <Field label={tx("packingPerPackage", "Packing per package")}><Input dir="ltr" inputMode="numeric" value={line.perPackage} disabled={locked} onChange={(event) => updateLine(setPacking, line.key, { perPackage: event.target.value })} /></Field>
                <Field label={tx("pieces", "Pieces")}><Input dir="ltr" readOnly value={Number.isFinite(pieces) ? String(pieces) : "0"} /></Field>
                <Field label={tx("grossKg", "Gross weight kg")}><Input dir="ltr" value={line.grossKg} disabled={locked} onChange={(event) => updateLine(setPacking, line.key, { grossKg: event.target.value })} /></Field>
                <Field label={tx("netKg", "Net weight without bags kg")} error={heavy ? tx("netAboveGross", "Net weight cannot exceed gross weight.") : undefined}><Input dir="ltr" value={line.netKg} disabled={locked} className={heavy ? "border-danger" : ""} onChange={(event) => updateLine(setPacking, line.key, { netKg: event.target.value })} /></Field>
                <div className="flex items-end"><Button type="button" size="sm" variant="outline" disabled={locked} onClick={() => setPacking((current) => current.filter((item) => item.key !== line.key))}>{tx("delete", "Delete")}</Button></div>
              </div>
            );
          })}
          <p className="text-sm font-semibold text-ink">TOTAL · {tx("packages", "Packages")} {summary.packing.packages} · {tx("pieces", "Pieces")} {summary.packing.pieces} · {tx("grossKg", "Gross")} {kgText(summary.packing.grossGrams)} · {tx("netKg", "Net")} {kgText(summary.packing.netGrams)}</p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={locked || busy} onClick={() => void saveDraft()}>{tx("tradeSaveDraft", "Save draft")}</Button>
        <Button type="button" disabled={locked || busy} onClick={() => void issue()}>{tx("tradeIssue", "Issue and attach to the operation")}</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => void downloadPdf(`/api/v1/invoices/${invoiceId}/commercial-pdf`, "commercial-invoice.pdf").catch((error) => notifyError(error))}>{tx("tradeDownloadInvoice", "Download commercial invoice PDF")}</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => void downloadPdf(`/api/v1/invoices/${invoiceId}/packing-pdf`, "packing-list.pdf").catch((error) => notifyError(error))}>{tx("tradeDownloadPacking", "Download packing list PDF")}</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => void downloadPdf(`/api/v1/invoices/${invoiceId}/customs-pdf`, "customs-bundle.pdf").catch((error) => notifyError(error))}>{tx("tradeDownloadCustoms", "Download combined customs PDF")}</Button>
      </div>
      <CompanyDialog open={companyOpen} onClose={() => setCompanyOpen(false)} />
      <CatalogDialog open={catalogOpen} onClose={() => setCatalogOpen(false)} />
    </section>
  );
}

function ReconciliationBar({ summary }: { summary: ReturnType<typeof liveReconciliation> }) {
  const { tx } = useCopy();
  const rows = [
    [tx("pieces", "Pieces"), summary.differences.pieces],
    [tx("packages", "Packages"), summary.differences.packages],
    [tx("grossKg", "Gross weight"), summary.differences.grossGrams / 1000],
    [tx("netKg", "Net weight"), summary.differences.netGrams / 1000],
  ] as const;
  return (
    <div className={cn("rounded-control border px-3 py-2 text-sm", summary.matched ? "border-ok/40 bg-ok/10 text-ok" : "border-danger/40 bg-danger/10 text-danger")} role="status">
      <p className="font-semibold">{summary.matched ? tx("tradeMatched", "Invoice and packing totals match") : tx("tradeDiffers", "Invoice and packing totals differ")}</p>
      <p className="mt-1 text-xs">
        {rows.map(([label, diff]) => `${label} ${diff > 0 ? "+" : ""}${Number.isInteger(diff) ? diff : diff.toFixed(3)}`).join(" · ")}
      </p>
    </div>
  );
}

function blankInvoiceLine(): InvoiceDraftLine {
  return { key: newKey(), description: "", hsCode: "", barcode: "", unit: "PCS", quantity: "1", price: "0.00" };
}

function blankPackingLine(): PackingDraftLine {
  return { key: newKey(), containerId: "", description: "", hsCode: "", packages: "1", perPackage: "1", grossKg: "0.000", netKg: "0.000" };
}

function toInvoiceLine(line: SheetLine): InvoiceDraftLine {
  return { key: newKey(), description: line.description, hsCode: line.hs_code ?? "", barcode: line.barcode ?? "", unit: line.unit_label ?? "PCS", quantity: String(line.quantity), price: moneyText(line.unit_price_minor) };
}

function toPackingLine(line: SheetPack): PackingDraftLine {
  return { key: newKey(), containerId: line.container_id ?? "", description: line.description, hsCode: line.hs_code ?? "", packages: String(line.packages_count), perPackage: String(line.packing_per_package), grossKg: kgText(line.gross_weight_grams), netKg: kgText(line.net_weight_grams) };
}

function serializeInvoice(line: InvoiceDraftLine) {
  return { description: line.description, hsCode: line.hsCode, barcode: line.barcode, unit: line.unit, quantity: Number(line.quantity), unitPriceMinor: moneyMinor(line.price) };
}

function gramsOrZero(value: string) {
  const grams = kgToGrams(value);
  return Number.isFinite(grams) ? grams : 0;
}

function serializePacking(line: PackingDraftLine) {
  return { description: line.description, hsCode: line.hsCode, containerId: line.containerId || null, packagesCount: Number(line.packages), packingPerPackage: Number(line.perPackage), grossWeightGrams: gramsOrZero(line.grossKg), netWeightGrams: gramsOrZero(line.netKg) };
}

function updateLine<T extends { key: string }>(set: (value: (current: T[]) => T[]) => void, key: string, patch: Partial<T>) {
  set((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item));
}
