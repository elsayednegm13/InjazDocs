import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { EmptyState, Ltr, PageHeader } from "@/components/ui/chrome";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { api } from "@/lib/api";
import { notifyError, notifySuccess } from "@/lib/notify";
import { useCopy } from "@/lib/copy";
import { downloadPdf, lineAmount, moneyMinor, moneyText, newKey, type BankAccount, type InvoiceDraftLine, type ProductPreset } from "./trade-model";

type Proforma = {
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
  exporter_bank_account_id: string | null;
  sea_freight_minor: number;
  fob_total_minor: number;
  total_minor: number;
  lines?: Array<{ description: string; unit_label: string | null; quantity: number; unit_price_minor: number }>;
};

export function ProformaListPage() {
  const { tx } = useCopy();
  const list = useQuery({ queryKey: ["proformas"], queryFn: async () => (await api<Proforma[]>("/api/v1/proformas")).data });
  return (
    <div className="space-y-4">
      <PageHeader
        title={tx("proformas", "Proforma invoices")}
        subtitle={tx("proformasHint", "A proforma can stand alone, then be linked to an export operation and converted.")}
        actions={<Button asChild size="sm"><Link to="/proformas/new">{tx("proformaNew", "New proforma")}</Link></Button>}
      />
      {(list.data ?? []).length === 0 ? <EmptyState>{tx("proformaEmpty", "No proforma invoices yet.")}</EmptyState> : (
        <ul className="space-y-2">
          {(list.data ?? []).map((row) => (
            <li key={row.id}>
              <Link to={`/proformas/${row.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-line bg-card px-3 py-2 text-sm shadow-card">
                <span className="font-medium text-ink"><Ltr>{row.invoice_number}</Ltr> {row.print_reference ? <span className="text-ink-muted">· {row.print_reference}</span> : null}</span>
                <span className="text-xs text-ink-muted">{row.status} · {moneyText(row.total_minor)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ProformaEditorPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const isNew = !id || id === "new";
  const existing = useQuery({
    queryKey: ["proforma", id],
    enabled: !isNew,
    queryFn: async () => (await api<Proforma>(`/api/v1/proformas/${id}`)).data,
  });
  if (!isNew && existing.isLoading) return <p className="text-sm text-ink-muted">…</p>;
  return <ProformaForm initial={existing.data} caseId={params.get("caseId") ?? existing.data?.case_id ?? ""} />;
}

function ProformaForm({ initial, caseId }: { initial?: Proforma; caseId: string }) {
  const { tx } = useCopy();
  const navigate = useNavigate();
  const client = useQueryClient();
  const banks = useQuery({ queryKey: ["exporter-banks"], queryFn: async () => (await api<BankAccount[]>("/api/v1/settings/exporter-bank-accounts")).data });
  const presets = useQuery({ queryKey: ["product-presets"], queryFn: async () => (await api<ProductPreset[]>("/api/v1/product-presets")).data });
  const customers = useQuery({ queryKey: ["customers", "proforma"], queryFn: async () => (await api<Array<{ id: string; legal_name: string }>>("/api/v1/customers?pageSize=100")).data });
  const [customerId, setCustomerId] = useState(initial?.customer_id ?? "");
  const [linkedCase, setLinkedCase] = useState(caseId);
  const [number, setNumber] = useState(initial?.invoice_number ?? "");
  const [reference, setReference] = useState(initial?.print_reference ?? "");
  const [date, setDate] = useState(initial?.invoice_date ?? new Date().toISOString().slice(0, 10));
  const [paymentCode, setPaymentCode] = useState(initial?.payment_term_code ?? "TT");
  const [paymentLabel, setPaymentLabel] = useState(initial?.payment_term_label ?? "100% ADVANCE");
  const [shipping, setShipping] = useState(initial?.shipping_method_label ?? "CFR");
  const [origin, setOrigin] = useState(initial?.origin_of_goods ?? "EGYPT");
  const [bankId, setBankId] = useState(initial?.exporter_bank_account_id ?? "");
  const [freight, setFreight] = useState(moneyText(initial?.sea_freight_minor ?? 0));
  const [lines, setLines] = useState<InvoiceDraftLine[]>(initial?.lines?.length ? initial.lines.map((line) => ({ key: newKey(), description: line.description, hsCode: "", barcode: "", unit: line.unit_label ?? "PCS", quantity: String(line.quantity), price: moneyText(line.unit_price_minor) })) : [{ key: newKey(), description: "", hsCode: "", barcode: "", unit: "PCS", quantity: "1", price: "0.00" }]);
  const [busy, setBusy] = useState(false);
  const issued = initial?.status === "ISSUED";
  const fob = lines.reduce((sum, line) => sum + lineAmount(line, "USD"), 0);
  const freightMinor = safeMinor(freight);

  function payload() {
    return {
      customerId,
      caseId: linkedCase || null,
      invoiceNumber: number,
      printReference: reference,
      invoiceDate: date,
      originOfGoods: origin,
      paymentTermCode: paymentCode,
      paymentTermLabel: paymentLabel,
      incoterm: shipping === "FOB" ? "FOB" : "CFR",
      shippingMethodLabel: shipping,
      exporterBankAccountId: bankId || null,
      seaFreightMinor: freightMinor,
      lines: lines.map((line) => ({ description: line.description, unit: line.unit, quantity: Number(line.quantity), unitPriceMinor: moneyMinor(line.price) })),
    };
  }

  async function save() {
    setBusy(true);
    try {
      if (initial?.id) {
        await api(`/api/v1/proformas/${initial.id}`, { method: "PUT", body: JSON.stringify(payload()) });
        notifySuccess(tx("tradeDraftSaved", "Draft saved"));
        await client.invalidateQueries({ queryKey: ["proforma", initial.id] });
      } else {
        const created = await api<Proforma>("/api/v1/proformas", { method: "POST", body: JSON.stringify(payload()) });
        notifySuccess(tx("tradeDraftSaved", "Draft saved"));
        navigate(`/proformas/${created.data.id}`);
      }
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  }

  async function issue() {
    if (!initial?.id) return;
    setBusy(true);
    try {
      await api(`/api/v1/proformas/${initial.id}/issue`, { method: "POST", body: "{}" });
      notifySuccess(tx("proformaIssued", "Proforma issued"));
      await client.invalidateQueries({ queryKey: ["proforma", initial.id] });
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  }

  async function convert() {
    if (!initial?.id) return;
    setBusy(true);
    try {
      const result = await api<{ invoiceId: string }>(`/api/v1/proformas/${initial.id}/convert`, { method: "POST", body: "{}" });
      notifySuccess(tx("proformaConverted", "Converted to the commercial invoice"));
      if (linkedCase) navigate(`/export-cases/${linkedCase}`);
      else notifySuccess(result.data.invoiceId);
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title={tx("proformaTitle", "Proforma invoice")} subtitle={reference || number || tx("proformaNew", "New proforma")} />
      <div className="grid gap-3 rounded-card border border-line bg-card p-3 shadow-card md:grid-cols-2">
        <Field label={tx("customer", "Customer")}>
          <Select value={customerId} disabled={issued} onChange={(event) => setCustomerId(event.target.value)}>
            <option value="">{tx("tradeChooseCustomer", "Choose a customer")}</option>
            {(customers.data ?? []).map((customer) => <option key={customer.id} value={customer.id}>{customer.legal_name}</option>)}
          </Select>
        </Field>
        <Field label={tx("tradeCaseId", "Operation id")}><Input dir="ltr" value={linkedCase} disabled={issued} onChange={(event) => setLinkedCase(event.target.value)} /></Field>
        <Field label={tx("invoiceNumber", "Invoice number")}><Input dir="ltr" value={number} disabled={issued} onChange={(event) => setNumber(event.target.value)} /></Field>
        <Field label={tx("printReference", "Print reference")}><Input dir="ltr" value={reference} disabled={issued} placeholder="EX-116" onChange={(event) => setReference(event.target.value)} /></Field>
        <Field label={tx("invoiceDate", "Invoice date")}><Input type="date" dir="ltr" value={date} disabled={issued} onChange={(event) => setDate(event.target.value)} /></Field>
        <Field label={tx("originOfGoods", "Origin of goods")}><Input value={origin} disabled={issued} onChange={(event) => setOrigin(event.target.value)} /></Field>
        <Field label={tx("paymentTerm", "Payment term")}>
          <Select value={paymentCode} disabled={issued} onChange={(event) => setPaymentCode(event.target.value)}>
            {["TT", "LC", "DP", "DA", "OTHER"].map((code) => <option key={code}>{code}</option>)}
          </Select>
        </Field>
        <Field label={tx("paymentTermLabel", "Payment term text")}><Input value={paymentLabel} disabled={issued} onChange={(event) => setPaymentLabel(event.target.value)} /></Field>
        <Field label={tx("shippingMethod", "Shipping method")}>
          <Select value={shipping} disabled={issued} onChange={(event) => setShipping(event.target.value)}><option>CFR</option><option>C&F</option><option>FOB</option></Select>
        </Field>
        <Field label={tx("seaFreight", "Sea freight")}><Input dir="ltr" value={freight} disabled={issued} onChange={(event) => setFreight(event.target.value)} /></Field>
        <Field label={tx("tradeBank", "Bank account")}>
          <Select value={bankId} disabled={issued} onChange={(event) => setBankId(event.target.value)}>
            <option value="">{tx("tradeNoBank", "No bank account")}</option>
            {(banks.data ?? []).map((bank) => <option key={bank.id} value={bank.id}>{bank.account_name}</option>)}
          </Select>
        </Field>
        <Field label={tx("tradeInsertPreset", "Insert from catalog")}>
          <Select value="" disabled={issued} onChange={(event) => {
            const preset = (presets.data ?? []).find((item) => item.id === event.target.value);
            if (!preset) return;
            setLines((current) => [...current, { key: newKey(), description: preset.description_template, hsCode: preset.hs_code ?? "", barcode: preset.barcode ?? "", unit: preset.unit_label ?? "PCS", quantity: "1", price: moneyText(preset.default_price_minor) }]);
          }}>
            <option value="">{tx("tradeChoosePreset", "Choose an item")}</option>
            {(presets.data ?? []).map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
          </Select>
        </Field>
        {lines.map((line) => (
          <div key={line.key} className="grid gap-2 md:col-span-2 md:grid-cols-6">
            <div className="md:col-span-2"><Field label={tx("description", "Description")}><Textarea className="min-h-16" value={line.description} disabled={issued} onChange={(event) => setLines((current) => current.map((item) => item.key === line.key ? { ...item, description: event.target.value } : item))} /></Field></div>
            <Field label={tx("unit", "Unit")}><Input value={line.unit} disabled={issued} onChange={(event) => setLines((current) => current.map((item) => item.key === line.key ? { ...item, unit: event.target.value } : item))} /></Field>
            <Field label={tx("quantity", "Quantity")}><Input dir="ltr" value={line.quantity} disabled={issued} onChange={(event) => setLines((current) => current.map((item) => item.key === line.key ? { ...item, quantity: event.target.value } : item))} /></Field>
            <Field label={tx("price", "Price")}><Input dir="ltr" value={line.price} disabled={issued} onChange={(event) => setLines((current) => current.map((item) => item.key === line.key ? { ...item, price: event.target.value } : item))} /></Field>
            <Field label={tx("amount", "Amount")}><Input dir="ltr" readOnly value={moneyText(lineAmount(line, "USD"))} /></Field>
          </div>
        ))}
        <p className="text-sm font-medium text-ink md:col-span-2" dir="ltr">TOTAL FOB {moneyText(fob)} + SEA FREIGHT {moneyText(freightMinor)} = {shipping === "FOB" ? "TOTAL FOB" : "TOTAL CFR / C&F"} {moneyText(shipping === "FOB" ? fob : fob + freightMinor)}</p>
        <div className="flex flex-wrap gap-2 md:col-span-2">
          <Button type="button" disabled={issued || busy} onClick={() => void save()}>{tx("tradeSaveDraft", "Save draft")}</Button>
          {initial?.id ? <Button type="button" variant="outline" disabled={issued || busy} onClick={() => void issue()}>{tx("proformaIssue", "Issue proforma")}</Button> : null}
          {initial?.id ? <Button type="button" size="sm" variant="outline" onClick={() => void downloadPdf(`/api/v1/proformas/${initial.id}/pdf`, "proforma.pdf").catch((error) => notifyError(error))}>{tx("proformaDownload", "Download proforma PDF")}</Button> : null}
          {initial?.id ? <Button type="button" size="sm" variant="outline" disabled={busy || !linkedCase} onClick={() => void convert()}>{tx("proformaConvert", "Convert to commercial invoice")}</Button> : null}
        </div>
      </div>
    </div>
  );
}

function safeMinor(value: string) {
  try {
    return moneyMinor(value);
  } catch {
    return 0;
  }
}
