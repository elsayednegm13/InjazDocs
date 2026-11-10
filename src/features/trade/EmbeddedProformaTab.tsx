import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookmarkPlus, Copy, FileDown, FilePlus2, ArrowLeftRight, CheckCircle2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Ltr } from "@/components/ui/chrome";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { api } from "@/lib/api";
import { notifyError, notifySuccess } from "@/lib/notify";
import { useCopy } from "@/lib/copy";
import { cn } from "@/lib/utils";
import { tradePdfFilename } from "@shared/trade-sheet";
import {
  downloadPdf,
  lineAmount,
  moneyMinor,
  moneyText,
  newKey,
  type BankAccount,
  type InvoiceDraftLine,
  type ProductPreset,
} from "./trade-model";
import { PaymentPresetStrip, PaymentTermField, saveLineToCatalog } from "./TradeDialogs";
import { includesFreight, ShippingMethodField, useShippingMethods } from "./TradeExtras";

export type CaseProformaRow = {
  id: string;
  invoice_number: string;
  print_reference: string | null;
  invoice_date: string;
  status: string;
  case_id: string | null;
  customer_id: string;
  payment_term_code: string;
  payment_term_label: string | null;
  incoterm: string;
  shipping_method_label: string | null;
  origin_of_goods: string | null;
  port_of_loading?: string | null;
  port_of_discharge?: string | null;
  exporter_bank_account_id: string | null;
  sea_freight_minor: number;
  fob_total_minor: number;
  total_minor: number;
  converted_invoice_id?: string | null;
  lines?: Array<{
    description: string;
    hs_code?: string | null;
    barcode?: string | null;
    unit_label: string | null;
    quantity: number;
    unit_price_minor: number;
  }>;
};

export function EmbeddedProformaTab({
  caseId,
  customerId,
  customerName,
  customerCode,
  customerCountry,
  currency,
  canEdit,
  defaultInvoiceNumber,
  onConverted,
}: {
  caseId: string;
  customerId: string;
  customerName: string;
  customerCode: string;
  customerCountry: string;
  currency: string;
  canEdit: boolean;
  defaultInvoiceNumber: string;
  onConverted?: () => void;
  onOpenCatalog?: () => void;
}) {
  const { tx } = useCopy();
  const client = useQueryClient();
  const listQuery = useQuery({
    queryKey: ["proformas", "case", caseId],
    enabled: Boolean(caseId),
    queryFn: async () => (await api<CaseProformaRow[]>(`/api/v1/proformas?caseId=${encodeURIComponent(caseId)}`)).data,
  });
  const banks = useQuery({
    queryKey: ["exporter-banks"],
    queryFn: async () => (await api<BankAccount[]>("/api/v1/settings/exporter-bank-accounts")).data,
  });
  const presets = useQuery({
    queryKey: ["product-presets"],
    queryFn: async () => (await api<ProductPreset[]>("/api/v1/product-presets")).data,
  });
  const methods = useShippingMethods();

  const proformas = listQuery.data ?? [];
  const [userSelectedId, setSelectedId] = useState<string | "new">("");
  const selectedId = userSelectedId || (proformas.length > 0 ? proformas[0].id : "new");

  const detailQuery = useQuery({
    queryKey: ["proforma", selectedId],
    enabled: Boolean(selectedId && selectedId !== "new"),
    queryFn: async () => (await api<CaseProformaRow>(`/api/v1/proformas/${selectedId}`)).data,
  });

  const active = selectedId !== "new" ? detailQuery.data : undefined;
  const issued = active?.status === "ISSUED";
  const locked = !canEdit || issued;

  const [number, setNumber] = useState("");
  const [reference, setReference] = useState(customerCode);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [paymentCode, setPaymentCode] = useState("TT");
  const [paymentLabel, setPaymentLabel] = useState("100% ADVANCE");
  const [shipping, setShipping] = useState("CFR");
  const [origin, setOrigin] = useState("EGYPT");
  const [portLoading, setPortLoading] = useState("");
  const [portDischarge, setPortDischarge] = useState("");
  const [bankId, setBankId] = useState("");
  const [freight, setFreight] = useState("0.00");
  const [lines, setLines] = useState<InvoiceDraftLine[]>([
    { key: newKey(), description: "", hsCode: "", barcode: "", unit: "Piece", quantity: "1", price: "0.00" },
  ]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (selectedId === "new") {
      setNumber(defaultInvoiceNumber ? `PI-${defaultInvoiceNumber}` : "");
      setReference(customerCode || "");
      setDate(new Date().toISOString().slice(0, 10));
      setPaymentCode("TT");
      setPaymentLabel("100% ADVANCE");
      setShipping("CFR");
      setOrigin("EGYPT");
      setPortLoading("");
      setPortDischarge("");
      setBankId(banks.data?.find((b) => b.is_default)?.id ?? "");
      setFreight("0.00");
      setLines([{ key: newKey(), description: "", hsCode: "", barcode: "", unit: "Piece", quantity: "1", price: "0.00" }]);
      return;
    }
    if (!active) return;
    setNumber(active.invoice_number ?? "");
    setReference(active.print_reference ?? customerCode ?? "");
    setDate(active.invoice_date ?? new Date().toISOString().slice(0, 10));
    setPaymentCode(active.payment_term_code ?? "TT");
    setPaymentLabel(active.payment_term_label ?? "100% ADVANCE");
    setShipping(active.shipping_method_label ?? active.incoterm ?? "CFR");
    setOrigin(active.origin_of_goods ?? "EGYPT");
    setPortLoading(active.port_of_loading ?? "");
    setPortDischarge(active.port_of_discharge ?? "");
    setBankId(active.exporter_bank_account_id ?? "");
    setFreight(moneyText(active.sea_freight_minor ?? 0, currency));
    setLines(
      active.lines?.length
        ? active.lines.map((line) => ({
            key: newKey(),
            description: line.description,
            hsCode: line.hs_code ?? "",
            barcode: line.barcode ?? "",
            unit: line.unit_label ?? "Piece",
            quantity: String(line.quantity),
            price: moneyText(line.unit_price_minor, currency),
          }))
        : [{ key: newKey(), description: "", hsCode: "", barcode: "", unit: "Piece", quantity: "1", price: "0.00" }],
    );
  }, [selectedId, active, customerCode, currency, defaultInvoiceNumber, banks.data]);

  const freightOn = includesFreight(shipping, methods.data ?? []);
  const fob = lines.reduce((sum, line) => sum + lineAmount(line, currency), 0);
  let freightMinor = 0;
  try {
    freightMinor = moneyMinor(freight, currency);
  } catch {
    freightMinor = 0;
  }
  const grandTotalMinor = freightOn ? fob + freightMinor : fob;

  function buildPayload() {
    return {
      customerId,
      caseId: caseId || null,
      invoiceNumber: number,
      printReference: reference,
      invoiceDate: date,
      originOfGoods: origin,
      portOfLoading: portLoading,
      portOfDischarge: portDischarge,
      paymentTermCode: paymentCode,
      paymentTermLabel: paymentLabel,
      incoterm: freightOn ? "CFR" : "FOB",
      shippingMethodLabel: shipping,
      exporterBankAccountId: bankId || null,
      currency,
      seaFreightMinor: freightMinor,
      lines: lines.map((line) => ({
        description: line.description,
        unit: line.unit,
        quantity: Number(line.quantity),
        unitPriceMinor: moneyMinor(line.price, currency),
      })),
    };
  }

  async function saveProforma() {
    setBusy(true);
    try {
      if (selectedId && selectedId !== "new") {
        await api(`/api/v1/proformas/${selectedId}`, { method: "PUT", body: JSON.stringify(buildPayload()) });
        notifySuccess(tx("tradeDraftSaved", "تم حفظ مسودة الفاتورة المبدئية"));
        await client.invalidateQueries({ queryKey: ["proforma", selectedId] });
      } else {
        const created = await api<CaseProformaRow>("/api/v1/proformas", {
          method: "POST",
          body: JSON.stringify(buildPayload()),
        });
        notifySuccess(tx("tradeDraftSaved", "تم إنشاء الفاتورة المبدئية وحفظها"));
        setSelectedId(created.data.id);
      }
      await client.invalidateQueries({ queryKey: ["proformas", "case", caseId] });
      await client.invalidateQueries({ queryKey: ["trade-sheet"] });
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  }

  async function issueSelected() {
    if (!selectedId || selectedId === "new") return;
    setBusy(true);
    try {
      await api(`/api/v1/proformas/${selectedId}/issue`, { method: "POST", body: "{}" });
      notifySuccess(tx("proformaIssued", "تم إصدار الفاتورة المبدئية"));
      await client.invalidateQueries({ queryKey: ["proforma", selectedId] });
      await client.invalidateQueries({ queryKey: ["proformas", "case", caseId] });
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  }

  async function convertSelected() {
    if (!selectedId || selectedId === "new") return;
    setBusy(true);
    try {
      await api(`/api/v1/proformas/${selectedId}/convert`, { method: "POST", body: "{}" });
      notifySuccess(tx("proformaConverted", "تم نسخ وتحويل البنود إلى الفاتورة التجارية للعملية"));
      await client.invalidateQueries({ queryKey: ["proforma", selectedId] });
      await client.invalidateQueries({ queryKey: ["proformas", "case", caseId] });
      await client.invalidateQueries({ queryKey: ["trade-sheet"] });
      await client.invalidateQueries({ queryKey: ["case", caseId] });
      onConverted?.();
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Top Proforma Selector Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-paper/60 px-3.5 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-ink-muted">{tx("proformas", "الفواتير المبدئية للعملية")}:</span>
          {proformas.map((item) => (
            <Button
              key={item.id}
              type="button"
              size="sm"
              variant={selectedId === item.id ? "default" : "outline"}
              onClick={() => setSelectedId(item.id)}
            >
              <Ltr>{item.invoice_number}</Ltr>
              <span className="ms-1.5 rounded-full bg-black/10 px-1.5 py-0.2 text-[10px]">
                {item.status === "ISSUED" ? "معتمدة" : "مسودة"}
              </span>
            </Button>
          ))}
          {canEdit ? (
            <Button
              type="button"
              size="sm"
              variant={selectedId === "new" ? "default" : "outline"}
              onClick={() => setSelectedId("new")}
            >
              <FilePlus2 className="h-3.5 w-3.5" />
              {tx("proformaNew", "فاتورة مبدئية جديدة")}
            </Button>
          ) : null}
        </div>
        {selectedId && selectedId !== "new" ? (
          <div className="flex flex-wrap gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                void downloadPdf(
                  `/api/v1/proformas/${selectedId}/pdf`,
                  tradePdfFilename({
                    invoiceNumber: number || selectedId,
                    clientName: customerName || "CLIENT",
                    clientCode: customerCode || reference || "NA",
                    country: customerCountry || "NA",
                  }),
                ).catch(notifyError)
              }
            >
              <FileDown className="h-3.5 w-3.5" />
              {tx("proformaDownload", "PDF المبدئية")}
            </Button>
            {canEdit ? (
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void convertSelected()}>
                <ArrowLeftRight className="h-3.5 w-3.5" />
                {tx("proformaConvert", "اعتماد وتحويل إلى الفاتورة التجارية")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* 12-Column Aligned Header Form (4 Equal Columns) */}
      <div className="rounded-xl border border-line bg-paper/30 p-4">
        <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-4">
          <Field label={tx("invoiceNumber", "رقم الفاتورة المبدئية")}>
            <Input
              dir="ltr"
              className="h-10"
              value={number}
              disabled={locked}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="PI-2026-01"
            />
          </Field>
          <Field label={tx("printReference", "المرجع المطبوع (كود العميل)")}>
            <Input
              dir="ltr"
              className="h-10"
              value={reference}
              disabled={locked}
              onChange={(e) => setReference(e.target.value)}
              placeholder="EX-116"
            />
          </Field>
          <Field label={tx("invoiceDate", "تاريخ الفاتورة")}>
            <Input
              type="date"
              dir="ltr"
              className="h-10"
              value={date}
              disabled={locked}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field label={tx("paymentTerm", "نوع الدفع")}>
            <Select
              className="h-10"
              value={paymentCode}
              disabled={locked}
              onChange={(e) => setPaymentCode(e.target.value)}
            >
              {["TT", "LC", "DP", "DA", "OTHER"].map((code) => (
                <option key={code} value={code}>{code}</option>
              ))}
            </Select>
          </Field>

          <PaymentTermField value={paymentLabel} disabled={locked} onChange={setPaymentLabel} />
          <ShippingMethodField value={shipping} disabled={locked} onChange={setShipping} />
          <Field label={tx("originOfGoods", "بلد المنشأ")}>
            <Input
              dir="ltr"
              className="h-10"
              value={origin}
              disabled={locked}
              onChange={(e) => setOrigin(e.target.value)}
            />
          </Field>
          <Field label={tx("seaFreight", "تكلفة الشحن البحري")}>
            <Input
              dir="ltr"
              className="h-10"
              value={freight}
              disabled={locked}
              onChange={(e) => setFreight(e.target.value)}
            />
          </Field>

          <Field label={tx("portOfLoading", "ميناء الشحن")}>
            <Input
              dir="ltr"
              className="h-10"
              value={portLoading}
              disabled={locked}
              onChange={(e) => setPortLoading(e.target.value)}
            />
          </Field>
          <Field label={tx("portOfDischarge", "ميناء الوصول")}>
            <Input
              dir="ltr"
              className="h-10"
              value={portDischarge}
              disabled={locked}
              onChange={(e) => setPortDischarge(e.target.value)}
            />
          </Field>
          <div className="md:col-span-2">
            <Field label={tx("tradeBank", "حساب البنك المصدر")}>
              <Select
                className="h-10"
                value={bankId}
                disabled={locked}
                onChange={(e) => setBankId(e.target.value)}
              >
                <option value="">{tx("tradeNoBank", "بدون حساب بنكي")}</option>
                {(banks.data ?? []).map((bank) => (
                  <option key={bank.id} value={bank.id}>{bank.account_name}</option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="border-t border-line/60 pt-2.5 md:col-span-4">
            <PaymentPresetStrip value={paymentLabel} disabled={locked} onChange={setPaymentLabel} />
          </div>
        </div>
      </div>

      {/* True Spreadsheet Table UI for Proforma Lines */}
      <div className="overflow-hidden rounded-xl border border-line bg-card shadow-sm">
        {/* Table Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-paper/60 px-3.5 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-ink">{tx("proformaItemsTableTitle", "جدول بنود الفاتورة المبدئية")}</span>
            <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent">
              {lines.length} {tx("itemsCountLabel", "بنود")}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value=""
              disabled={locked}
              className="h-9 w-56 text-xs"
              onChange={(event) => {
                const preset = (presets.data ?? []).find((item) => item.id === event.target.value);
                event.target.value = "";
                if (!preset) return;
                setLines((current) => [
                  ...current.filter((l) => l.description.trim()),
                  {
                    key: newKey(),
                    description: [preset.description_template, preset.ply, preset.material, preset.size_label].filter(Boolean).join("\n"),
                    hsCode: preset.hs_code ?? "",
                    barcode: preset.barcode ?? "",
                    unit: preset.unit_label ?? "Piece",
                    quantity: "1",
                    price: moneyText(preset.default_price_minor, currency),
                  },
                ]);
              }}
            >
              <option value="">{tx("tradeChoosePreset", "+ إدراج صنف سريع من الكتالوج...")}</option>
              {(presets.data ?? []).map((preset) => (
                <option key={preset.id} value={preset.id}>{preset.name}</option>
              ))}
            </Select>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={locked}
              onClick={() =>
                setLines((current) => [
                  ...current,
                  { key: newKey(), description: "", hsCode: "", barcode: "", unit: "Piece", quantity: "1", price: "0.00" },
                ])
              }
            >
              + {tx("tradeAddLine", "إضافة بند")}
            </Button>
          </div>
        </div>

        {/* 12-Col Grid Header */}
        <div className="hidden border-b border-line bg-slate-900/5 px-3.5 py-2 text-xs font-semibold text-ink-muted dark:bg-slate-900/60 md:grid md:grid-cols-[4fr_2fr_1fr_1.5fr_1.5fr_1.5fr_auto] md:items-center md:gap-2.5">
          <div>{tx("description", "وصف الصنف (Description)")}</div>
          <div>{tx("hsAndBarcode", "البند الجمركي / الباركود")}</div>
          <div className="text-center">{tx("unit", "الوحدة")}</div>
          <div className="text-center">{tx("quantity", "الكمية (QTY)")}</div>
          <div className="text-center">{tx("price", "سعر الوحدة")}</div>
          <div className="text-end">{tx("amount", "إجمالي السطر")}</div>
          <div className="w-24 text-center">{tx("actions", "إجراءات")}</div>
        </div>

        {/* Table Rows */}
        <div className="divide-y divide-line/70">
          {lines.map((line, idx) => (
            <div
              key={line.key}
              className="grid grid-cols-1 items-start gap-2.5 px-3.5 py-2.5 transition-colors hover:bg-paper/40 md:grid-cols-[4fr_2fr_1fr_1.5fr_1.5fr_1.5fr_auto]"
            >
              {/* Col 1 (4fr): Description */}
              <div className="flex items-start gap-2">
                <span className="mt-2 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-paper text-[11px] font-semibold text-ink-muted tabular-nums">
                  {idx + 1}
                </span>
                <Textarea
                  rows={2}
                  className="min-h-[60px] resize-y py-1.5 text-xs leading-relaxed"
                  placeholder={tx("descriptionPlaceholder", "وصف الصنف، عدد الطبقات، الخامة، المقاس...")}
                  value={line.description}
                  disabled={locked}
                  onChange={(e) =>
                    setLines((cur) => cur.map((item) => (item.key === line.key ? { ...item, description: e.target.value } : item)))
                  }
                />
              </div>

              {/* Col 2 (2fr): HS Code + Barcode */}
              <div className="grid gap-1.5">
                <Input
                  dir="ltr"
                  className="h-7 px-2 text-xs font-mono"
                  placeholder="HS Code"
                  value={line.hsCode}
                  disabled={locked}
                  onChange={(e) =>
                    setLines((cur) => cur.map((item) => (item.key === line.key ? { ...item, hsCode: e.target.value } : item)))
                  }
                />
                <Input
                  dir="ltr"
                  className="h-7 px-2 text-xs font-mono"
                  placeholder="Barcode"
                  value={line.barcode}
                  disabled={locked}
                  onChange={(e) =>
                    setLines((cur) => cur.map((item) => (item.key === line.key ? { ...item, barcode: e.target.value } : item)))
                  }
                />
              </div>

              {/* Col 3 (1fr): Unit */}
              <div>
                <Input
                  className="h-9 px-2 text-center text-xs"
                  value={line.unit}
                  disabled={locked}
                  onChange={(e) =>
                    setLines((cur) => cur.map((item) => (item.key === line.key ? { ...item, unit: e.target.value } : item)))
                  }
                />
              </div>

              {/* Col 4 (1.5fr): Quantity */}
              <div>
                <Input
                  dir="ltr"
                  inputMode="numeric"
                  className="h-9 px-2.5 text-center text-xs font-semibold tabular-nums"
                  value={line.quantity}
                  disabled={locked}
                  onChange={(e) =>
                    setLines((cur) => cur.map((item) => (item.key === line.key ? { ...item, quantity: e.target.value } : item)))
                  }
                />
              </div>

              {/* Col 5 (1.5fr): Unit Price */}
              <div>
                <Input
                  dir="ltr"
                  inputMode="decimal"
                  className="h-9 px-2.5 text-center text-xs tabular-nums"
                  value={line.price}
                  disabled={locked}
                  onChange={(e) =>
                    setLines((cur) => cur.map((item) => (item.key === line.key ? { ...item, price: e.target.value } : item)))
                  }
                />
              </div>

              {/* Col 6 (1.5fr): Line Amount */}
              <div className="flex h-9 items-center justify-end rounded-control border border-line/60 bg-paper/60 px-2.5 text-xs font-bold tabular-nums text-ink" dir="ltr">
                {moneyText(lineAmount(line, currency), currency)} {currency}
              </div>

              {/* Col 7 (0.5fr / auto): Compact Icon Actions */}
              <div className="flex h-9 w-24 items-center justify-center gap-1">
                <button
                  type="button"
                  disabled={locked}
                  title={tx("tradeCopyLine", "تكرار السطر")}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-line bg-card text-ink-muted transition-colors hover:border-accent/50 hover:text-accent disabled:opacity-40"
                  onClick={() => setLines((cur) => [...cur, { ...line, key: newKey() }])}
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  disabled={locked || !line.description.trim()}
                  title={tx("tradeSaveLineCatalog", "حفظ في الكتالوج")}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-line bg-card text-ink-muted transition-colors hover:border-accent/50 hover:text-accent disabled:opacity-40"
                  onClick={() =>
                    void saveLineToCatalog(line)
                      .then(() => {
                        notifySuccess(tx("tradePresetSaved", "تم حفظ الصنف في الكتالوج"));
                        return client.invalidateQueries({ queryKey: ["product-presets"] });
                      })
                      .catch(notifyError)
                  }
                >
                  <BookmarkPlus className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  disabled={locked}
                  title={tx("tradeRemoveLine", "حذف البند")}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-line bg-card text-danger/80 transition-colors hover:border-danger/40 hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                  onClick={() =>
                    setLines((cur) =>
                      cur.length === 1
                        ? [{ key: newKey(), description: "", hsCode: "", barcode: "", unit: "Piece", quantity: "1", price: "0.00" }]
                        : cur.filter((item) => item.key !== line.key),
                    )
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* 3-Cell Financial Totals Footer */}
        <div className="grid grid-cols-1 divide-y divide-line border-t border-line bg-slate-900/5 dark:bg-slate-900/50 md:grid-cols-3 md:divide-x md:divide-y-0 md:divide-x-reverse">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-xs font-medium text-ink-muted">{tx("fobTotalLabel", "إجمالي البضاعة (FOB)")}</span>
            <span className="text-sm font-semibold tabular-nums text-ink" dir="ltr">
              {moneyText(fob, currency)} {currency}
            </span>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-xs font-medium text-ink-muted">
              {tx("seaFreightTotalLabel", "الشحن البحري (Freight)")}
              {!freightOn ? <span className="ms-1 text-[11px] opacity-75">(غير مضاف على {shipping})</span> : null}
            </span>
            <span className={cn("text-sm font-semibold tabular-nums", freightOn ? "text-ink" : "text-ink-muted")} dir="ltr">
              {freightOn ? `${moneyText(freightMinor, currency)} ${currency}` : `0.00 ${currency}`}
            </span>
          </div>
          <div className="flex items-center justify-between bg-accent/[0.06] px-4 py-3">
            <span className="text-xs font-bold text-ink">{tx("grandTotalLabel", `الإجمالي النهائي (${shipping})`)}</span>
            <span className="text-base font-bold tabular-nums text-accent" dir="ltr">
              {moneyText(grandTotalMinor, currency)} {currency}
            </span>
          </div>
        </div>
      </div>

      {/* Proforma Action Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-paper/60 px-4 py-3">
        <span className="text-xs text-ink-muted">
          {issued
            ? tx("proformaStatusIssuedHint", "هذه الفاتورة المبدئية معتمدة ومصدرة. يمكنك تحميلها أو تحويلها مباشرة للفاتورة التجارية.")
            : tx("proformaStatusDraftHint", "احفظ مسودة الفاتورة المبدئية أو اعتمدها وحوّل بنودها إلى الفاتورة التجارية للعملية.")}
        </span>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={locked || busy || !customerId} onClick={() => void saveProforma()}>
            {tx("tradeSaveDraft", "حفظ الفاتورة المبدئية")}
          </Button>
          {selectedId && selectedId !== "new" && !issued ? (
            <Button type="button" size="sm" variant="outline" disabled={locked || busy} onClick={() => void issueSelected()}>
              <CheckCircle2 className="h-3.5 w-3.5" />
              {tx("proformaIssue", "إصدار الفاتورة المبدئية")}
            </Button>
          ) : null}
          {selectedId && selectedId !== "new" ? (
            <Button type="button" size="sm" disabled={!canEdit || busy} onClick={() => void convertSelected()}>
              <ArrowLeftRight className="h-3.5 w-3.5" />
              {tx("proformaConvert", "تحويل إلى الفاتورة التجارية")}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
