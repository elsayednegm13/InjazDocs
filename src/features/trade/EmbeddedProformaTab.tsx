import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Ltr } from "@/components/ui/chrome";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { api } from "@/lib/api";
import { notifyError, notifySuccess } from "@/lib/notify";
import { useCopy } from "@/lib/copy";
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
import { PaymentTermField, saveLineToCatalog } from "./TradeDialogs";
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
  lines?: Array<{ description: string; unit_label: string | null; quantity: number; unit_price_minor: number }>;
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
  onOpenCatalog,
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
  onOpenCatalog: () => void;
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
  const [selectedId, setSelectedId] = useState<string | "new">("");

  useEffect(() => {
    if (!selectedId && proformas.length > 0) {
      setSelectedId(proformas[0].id);
    } else if (!selectedId && !listQuery.isLoading && proformas.length === 0) {
      setSelectedId("new");
    }
  }, [proformas, selectedId, listQuery.isLoading]);

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
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentCode, setPaymentCode] = useState("TT");
  const [paymentLabel, setPaymentLabel] = useState("100% ADVANCE");
  const [shipping, setShipping] = useState("CFR");
  const [origin, setOrigin] = useState("EGYPT");
  const [portLoading, setPortLoading] = useState("");
  const [portDischarge, setPortDischarge] = useState("");
  const [bankId, setBankId] = useState("");
  const [freight, setFreight] = useState("0.00");
  const [lines, setLines] = useState<InvoiceDraftLine[]>([
    { key: newKey(), description: "", hsCode: "", barcode: "", unit: "PCS", quantity: "1", price: "0.00" },
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
      setLines([{ key: newKey(), description: "", hsCode: "", barcode: "", unit: "PCS", quantity: "1", price: "0.00" }]);
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
            hsCode: "",
            barcode: "",
            unit: line.unit_label ?? "PCS",
            quantity: String(line.quantity),
            price: moneyText(line.unit_price_minor, currency),
          }))
        : [{ key: newKey(), description: "", hsCode: "", barcode: "", unit: "PCS", quantity: "1", price: "0.00" }],
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
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-line bg-paper/60 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-ink">{tx("proformas", "الفواتير المبدئية للعملية")}:</span>
          {proformas.map((item) => (
            <Button
              key={item.id}
              type="button"
              size="sm"
              variant={selectedId === item.id ? "default" : "outline"}
              onClick={() => setSelectedId(item.id)}
            >
              <Ltr>{item.invoice_number}</Ltr> ({item.status})
            </Button>
          ))}
          {canEdit ? (
            <Button
              type="button"
              size="sm"
              variant={selectedId === "new" ? "default" : "outline"}
              onClick={() => setSelectedId("new")}
            >
              + {tx("proformaNew", "فاتورة مبدئية جديدة")}
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
              {tx("proformaDownload", "تحميل PDF المبدئية")}
            </Button>
            {canEdit ? (
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void convertSelected()}>
                {tx("proformaConvert", "اعتماد وتحويل إلى الفاتورة التجارية")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Field label={tx("invoiceNumber", "رقم الفاتورة المبدئية")}>
          <Input dir="ltr" value={number} disabled={locked} onChange={(e) => setNumber(e.target.value)} placeholder="PI-2026-01" />
        </Field>
        <Field label={tx("printReference", "المرجع المطبوع")}>
          <Input dir="ltr" value={reference} disabled={locked} onChange={(e) => setReference(e.target.value)} placeholder="EX-116" />
        </Field>
        <Field label={tx("invoiceDate", "التاريخ")}>
          <Input type="date" dir="ltr" value={date} disabled={locked} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label={tx("paymentTerm", "نوع الدفع")}>
          <Select value={paymentCode} disabled={locked} onChange={(e) => setPaymentCode(e.target.value)}>
            {["TT", "LC", "DP", "DA", "OTHER"].map((code) => (
              <option key={code} value={code}>{code}</option>
            ))}
          </Select>
        </Field>
        <PaymentTermField value={paymentLabel} disabled={locked} onChange={setPaymentLabel} />
        <ShippingMethodField value={shipping} disabled={locked} onChange={setShipping} />
        <Field label={tx("originOfGoods", "بلد المنشأ")}>
          <Input dir="ltr" value={origin} disabled={locked} onChange={(e) => setOrigin(e.target.value)} />
        </Field>
        <Field label={tx("seaFreight", "النولون البحري")}>
          <Input dir="ltr" value={freight} disabled={locked} onChange={(e) => setFreight(e.target.value)} />
        </Field>
        <Field label={tx("portOfLoading", "ميناء الشحن")}>
          <Input dir="ltr" value={portLoading} disabled={locked} onChange={(e) => setPortLoading(e.target.value)} />
        </Field>
        <Field label={tx("portOfDischarge", "ميناء الوصول")}>
          <Input dir="ltr" value={portDischarge} disabled={locked} onChange={(e) => setPortDischarge(e.target.value)} />
        </Field>
        <Field label={tx("tradeBank", "حساب البنك المصدر")}>
          <Select value={bankId} disabled={locked} onChange={(e) => setBankId(e.target.value)}>
            <option value="">{tx("tradeNoBank", "بدون حساب بنكي")}</option>
            {(banks.data ?? []).map((bank) => (
              <option key={bank.id} value={bank.id}>{bank.account_name}</option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-control border border-line bg-paper p-2">
        <Field label={tx("tradeInsertPreset", "إدراج صنف من الكتالوج")}>
          <Select
            value=""
            disabled={locked}
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
                  unit: preset.unit_label ?? "PCS",
                  quantity: "1",
                  price: moneyText(preset.default_price_minor, currency),
                },
              ]);
            }}
          >
            <option value="">{tx("tradeChoosePreset", "اختر صنفاً من الكتالوج")}</option>
            {(presets.data ?? []).map((preset) => (
              <option key={preset.id} value={preset.id}>{preset.name}</option>
            ))}
          </Select>
        </Field>
        <Button type="button" size="sm" variant="outline" disabled={locked} onClick={onOpenCatalog}>
          {tx("tradeManageCatalog", "إدارة الكتالوج")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={locked}
          onClick={() => setLines((current) => [...current, { key: newKey(), description: "", hsCode: "", barcode: "", unit: "PCS", quantity: "1", price: "0.00" }])}
        >
          + {tx("tradeAddLine", "إضافة بند")}
        </Button>
      </div>

      <div className="space-y-2">
        {lines.map((line) => (
          <div key={line.key} className="grid gap-2 rounded-control border border-line p-2 md:grid-cols-6">
            <div className="md:col-span-2">
              <Field label={tx("description", "الوصف")}>
                <Textarea
                  className="min-h-14"
                  value={line.description}
                  disabled={locked}
                  onChange={(e) => setLines((cur) => cur.map((item) => (item.key === line.key ? { ...item, description: e.target.value } : item)))}
                />
              </Field>
            </div>
            <Field label={tx("unit", "الوحدة")}>
              <Input value={line.unit} disabled={locked} onChange={(e) => setLines((cur) => cur.map((item) => (item.key === line.key ? { ...item, unit: e.target.value } : item)))} />
            </Field>
            <Field label={tx("quantity", "الكمية")}>
              <Input dir="ltr" inputMode="numeric" value={line.quantity} disabled={locked} onChange={(e) => setLines((cur) => cur.map((item) => (item.key === line.key ? { ...item, quantity: e.target.value } : item)))} />
            </Field>
            <Field label={tx("price", "السعر")}>
              <Input dir="ltr" value={line.price} disabled={locked} onChange={(e) => setLines((cur) => cur.map((item) => (item.key === line.key ? { ...item, price: e.target.value } : item)))} />
            </Field>
            <Field label={tx("amount", "الإجمالي")}>
              <Input dir="ltr" readOnly value={moneyText(lineAmount(line, currency), currency)} />
            </Field>
            <div className="flex items-end gap-2 md:col-span-6">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={locked}
                onClick={() =>
                  setLines((cur) =>
                    cur.length === 1
                      ? [{ key: newKey(), description: "", hsCode: "", barcode: "", unit: "PCS", quantity: "1", price: "0.00" }]
                      : cur.filter((item) => item.key !== line.key),
                  )
                }
              >
                {tx("tradeRemoveLine", "حذف البند")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={locked || !line.description.trim()}
                onClick={() =>
                  void saveLineToCatalog(line)
                    .then(() => {
                      notifySuccess(tx("tradePresetSaved", "تم حفظ الصنف في الكتالوج"));
                      return client.invalidateQueries({ queryKey: ["product-presets"] });
                    })
                    .catch(notifyError)
                }
              >
                {tx("tradeSaveLineCatalog", "حفظ في الكتالوج")}
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-line bg-paper px-3 py-2">
        <p className="text-sm font-semibold text-ink" dir="ltr">
          TOTAL FOB {moneyText(fob, currency)}
          {freightOn ? ` + SEA FREIGHT ${moneyText(freightMinor, currency)} = TOTAL ${shipping} ${moneyText(fob + freightMinor, currency)}` : ""}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={locked || busy || !customerId} onClick={() => void saveProforma()}>
            {tx("tradeSaveDraft", "حفظ الفاتورة المبدئية")}
          </Button>
          {selectedId && selectedId !== "new" && !issued ? (
            <Button type="button" size="sm" variant="outline" disabled={locked || busy} onClick={() => void issueSelected()}>
              {tx("proformaIssue", "إصدار الفاتورة المبدئية")}
            </Button>
          ) : null}
          {selectedId && selectedId !== "new" ? (
            <Button type="button" size="sm" variant="outline" disabled={!canEdit || busy} onClick={() => void convertSelected()}>
              {tx("proformaConvert", "تحويل إلى الفاتورة التجارية")}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

