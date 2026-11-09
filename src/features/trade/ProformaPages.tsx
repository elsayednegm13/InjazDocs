import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { EmptyState, Ltr, PageHeader } from "@/components/ui/chrome";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { api } from "@/lib/api";
import { notifyError, notifySuccess } from "@/lib/notify";
import { useCopy } from "@/lib/copy";
import { tradePdfFilename } from "@shared/trade-sheet";
import { defaultPrintFields, parsePrintFields, resolvePrintRows, type CustomerPrintProfile } from "@shared/trade-print-fields";
import { LiveInvoiceView, stampFromRow, type LiveSheetModel } from "./LiveSheet";
import { PrintFieldsPanel, useCustomerPrintProfile } from "./PrintFields";
import { downloadPdf, lineAmount, moneyMinor, moneyText, newKey, type BankAccount, type InvoiceDraftLine, type ProductPreset } from "./trade-model";
import { CatalogDialog, CompanyDialog, PaymentTermField, saveLineToCatalog } from "./TradeDialogs";
import { includesFreight, ShippingMethodField, useShippingMethods } from "./TradeExtras";

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
  customer_name?: string;
  customer_code?: string | null;
  customer_country?: string | null;
  port_of_loading?: string | null;
  port_of_discharge?: string | null;
  is_stamped?: number;
  stamp_x?: number | null;
  stamp_y?: number | null;
  stamp_x_ratio?: number | null;
  stamp_y_ratio?: number | null;
  stamp_scale?: number | null;
  stamp_rotation?: number | null;
  print_fields_json?: string | null;
  lines?: Array<{ description: string; unit_label: string | null; quantity: number; unit_price_minor: number }>;
};

export function ProformaListPage() {
  const { tx } = useCopy();
  const client = useQueryClient();
  const list = useQuery({ queryKey: ["proformas"], queryFn: async () => (await api<Proforma[]>("/api/v1/proformas")).data });
  const rows = list.data ?? [];
  return (
    <div className="space-y-4">
      <PageHeader
        title={tx("proformas", "Proforma invoices")}
        subtitle={tx("proformasHint", "A proforma can stand alone, then be linked to an export operation and converted.")}
        actions={<Button asChild size="sm"><Link to="/proformas/new">{tx("proformaNew", "New proforma")}</Link></Button>}
      />
      {rows.length === 0 ? <EmptyState>{tx("proformaEmpty", "No proforma invoices yet.")}</EmptyState> : (
        <div className="overflow-x-auto rounded-card border border-line bg-card shadow-card">
          <table className="w-full min-w-[920px] border-collapse text-start text-sm">
            <thead className="bg-paper text-[11px] uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2 font-medium">{tx("customer", "Customer")}</th>
                <th className="px-3 py-2 font-medium">{tx("invoiceNumber", "Invoice")}</th>
                <th className="px-3 py-2 font-medium">{tx("shippingMethod", "Shipping")}</th>
                <th className="px-3 py-2 font-medium">{tx("tradeBeforeFreight", "Before freight")}</th>
                <th className="px-3 py-2 font-medium">{tx("tradeAfterFreight", "After freight")}</th>
                <th className="px-3 py-2 font-medium">{tx("status", "Status")}</th>
                <th className="px-3 py-2 font-medium">{tx("actions", "Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-line">
                  <td className="px-3 py-2">
                    <span className="font-medium text-ink">{row.customer_name}</span>
                    {row.customer_code ? <span className="ms-2 rounded-full bg-accent/10 px-1.5 py-0.5 text-[11px] font-semibold text-accent" dir="ltr">{row.customer_code}</span> : null}
                  </td>
                  <td className="px-3 py-2"><Ltr>{row.invoice_number}</Ltr><span className="mt-0.5 block text-[11px] text-ink-muted"><Ltr>{row.invoice_date}</Ltr></span></td>
                  <td className="px-3 py-2"><span className="rounded-full border border-line px-1.5 py-0.5 text-[11px] font-semibold" dir="ltr">{row.shipping_method_label || "—"}</span><span className="mt-0.5 block text-[11px] text-ink-muted"><Ltr>{moneyText(row.sea_freight_minor)}</Ltr></span></td>
                  <td className="px-3 py-2 tabular-nums"><Ltr>{moneyText(row.fob_total_minor)}</Ltr></td>
                  <td className="px-3 py-2 text-base font-semibold tabular-nums text-ink"><Ltr>{moneyText(row.total_minor)}</Ltr></td>
                  <td className="px-3 py-2 text-xs">{row.status}{row.is_stamped ? ` · ${tx("tradeStamped", "Stamped")}` : ""}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      <Button asChild size="sm" variant="outline"><Link to={`/proformas/${row.id}`}>{tx("tradeOpen", "Open")}</Link></Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => void downloadPdf(`/api/v1/proformas/${row.id}/pdf`, tradePdfFilename({ invoiceNumber: row.invoice_number, clientName: row.customer_name ?? "CLIENT", clientCode: row.customer_code ?? "NA", country: row.customer_country ?? "NA" })).catch(notifyError)}>{tx("pdf", "PDF")}</Button>
                      <Button type="button" size="sm" variant="outline" disabled={!row.case_id} onClick={() => void api<{ invoiceId: string }>(`/api/v1/proformas/${row.id}/convert`, { method: "POST", body: "{}" }).then(() => { notifySuccess(tx("proformaConverted", "Converted")); return client.invalidateQueries({ queryKey: ["proformas"] }); }).catch(notifyError)}>{tx("proformaConvert", "Convert")}</Button>
                      {row.status === "DRAFT" ? <Button type="button" size="sm" variant="outline" onClick={() => void api(`/api/v1/proformas/${row.id}`, { method: "DELETE" }).then(() => { notifySuccess(tx("tradeDraftDeleted", "Draft deleted")); return client.invalidateQueries({ queryKey: ["proformas"] }); }).catch(notifyError)}>{tx("tradeDeleteDraft", "Delete draft")}</Button> : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
  const identity = useQuery({ queryKey: ["exporter-identity"], queryFn: async () => (await api<Record<string, string | null> | null>("/api/v1/settings/exporter-identity")).data });
  const presets = useQuery({ queryKey: ["product-presets"], queryFn: async () => (await api<ProductPreset[]>("/api/v1/product-presets")).data });
  const customers = useQuery({ queryKey: ["customers", "proforma"], queryFn: async () => (await api<Array<{ id: string; legal_name: string; customer_code: string | null; country_code: string | null }>>("/api/v1/customers?pageSize=100")).data });
  const [companyOpen, setCompanyOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [customerId, setCustomerId] = useState(initial?.customer_id ?? "");
  const [linkedCase, setLinkedCase] = useState(caseId);
  const [number, setNumber] = useState(initial?.invoice_number ?? "");
  const [reference, setReference] = useState(initial?.print_reference ?? "");
  const [date, setDate] = useState(initial?.invoice_date ?? new Date().toISOString().slice(0, 10));
  const [paymentCode, setPaymentCode] = useState(initial?.payment_term_code ?? "TT");
  const [paymentLabel, setPaymentLabel] = useState(initial?.payment_term_label ?? "100% ADVANCE");
  const [shipping, setShipping] = useState(initial?.shipping_method_label ?? "CFR");
  const [origin, setOrigin] = useState(initial?.origin_of_goods ?? "EGYPT");
  const [portLoading, setPortLoading] = useState(initial?.port_of_loading ?? "");
  const [portDischarge, setPortDischarge] = useState(initial?.port_of_discharge ?? "");
  const [bankId, setBankId] = useState(initial?.exporter_bank_account_id ?? "");
  const [freight, setFreight] = useState(moneyText(initial?.sea_freight_minor ?? 0));
  const [stamp, setStamp] = useState(stampFromRow(initial));
  const [printFields, setPrintFields] = useState(() => parsePrintFields(initial?.print_fields_json) ?? defaultPrintFields());
  const [lines, setLines] = useState<InvoiceDraftLine[]>(initial?.lines?.length ? initial.lines.map((line) => ({ key: newKey(), description: line.description, hsCode: "", barcode: "", unit: line.unit_label ?? "PCS", quantity: String(line.quantity), price: moneyText(line.unit_price_minor) })) : [{ key: newKey(), description: "", hsCode: "", barcode: "", unit: "PCS", quantity: "1", price: "0.00" }]);
  const [busy, setBusy] = useState(false);
  const printProfile = useCustomerPrintProfile(customerId);
  const methods = useShippingMethods();
  const freightOn = includesFreight(shipping, methods.data ?? []);
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
      portOfLoading: portLoading,
      portOfDischarge: portDischarge,
      paymentTermCode: paymentCode,
      paymentTermLabel: paymentLabel,
      incoterm: freightOn ? "CFR" : "FOB",
      shippingMethodLabel: shipping,
      exporterBankAccountId: bankId || null,
      seaFreightMinor: freightMinor,
      isStamped: stamp.stamped,
      stampXRatio: stamp.xRatio,
      stampYRatio: stamp.yRatio,
      stampScale: stamp.scale,
      stampRotation: stamp.rotation,
      printFields,
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

  function proformaLiveModel(): LiveSheetModel {
    const company = identity.data;
    const profile: CustomerPrintProfile = printProfile.data ?? { name: "", address: "", taxId: "", phone: "", email: "", bankName: "", accountName: "", accountLast4: "", ibanLast4: "", swift: "", code: "", country: "" };
    const printed = resolvePrintRows(printFields, profile, { date, invoiceNumber: number, reference });
    const customer = (customers.data ?? []).find((item) => item.id === customerId);
    const bank = (banks.data ?? []).find((item) => item.id === bankId);
    return {
      title: "PROFORMA INVOICE",
      draft: !issued,
      identity: {
        nameEn: company?.name_en ?? "",
        nameAr: company?.name_ar ?? "",
        address: company?.address ?? "",
        phone: company?.phone ?? "",
        email: company?.email ?? "",
        taxCard: company?.tax_card ?? "",
        taxFile: company?.tax_file ?? "",
        commercialRegistry: company?.commercial_registry ?? "",
      },
      meta: printed.meta.length ? printed.meta : [{ label: "DATE", value: date }, { label: "INVOICE NO#", value: number }],
      buyer: printed.buyer.length ? printed.buyer : [{ label: "BILL TO", value: profile.name }, { label: "ADDRESS", value: profile.address }, { label: "Registration number", value: profile.taxId }],
      columns: ["NO", "DESCRIPTION", "UNIT", "QTY", "PRICE", "AMOUNT"],
      lines: lines.map((line, index) => ({ cells: [String(index + 1), line.description || "—", line.unit, line.quantity, line.price, moneyText(lineAmount(line, "USD"))] })),
      totals: [{ label: "TOTAL F.O.B", value: moneyText(fob) }, ...(freightOn ? [{ label: "SEA FREIGHT", value: moneyText(freightMinor) }, { label: `TOTAL ${shipping}`, value: moneyText(fob + freightMinor) }] : [])],
      facts: [
        { label: "ORIGIN OF GOODS", value: origin },
        { label: "PORT OF LOADING", value: portLoading },
        { label: "PORT OF DISCHARGE", value: portDischarge },
        { label: "SHIPPING METHOD", value: shipping },
        { label: "PAYMENT TERM", value: paymentLabel },
      ],
      bank: bank ? [
        { label: "ACCOUNT NAME", value: bank.account_name },
        { label: "IBAN", value: bank.iban },
        { label: "BANK NAME", value: bank.bank_name },
        { label: "BANK ADDRESS", value: bank.bank_address ?? "" },
        { label: "SWIFT CODE", value: bank.swift_code ?? "" },
      ] : [],
      clientCode: reference || customer?.customer_code || "",
    };
  }

  return (
    <div className="space-y-4">
      <PageHeader title={tx("proformaTitle", "Proforma invoice")} subtitle={reference || number || tx("proformaNew", "New proforma")} />
      <div className="grid gap-3 rounded-card border border-line bg-card p-4 shadow-card md:grid-cols-2">
        <p className="md:col-span-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">{tx("tradeSectionDocument", "Document")}</p>
        <Field label={tx("customer", "Customer")}>
          <Select value={customerId} disabled={issued} onChange={(event) => {
            const next = event.target.value;
            setCustomerId(next);
            const code = (customers.data ?? []).find((customer) => customer.id === next)?.customer_code ?? "";
            if (!reference || reference === (customers.data ?? []).find((customer) => customer.id === customerId)?.customer_code) setReference(code ?? "");
          }}>
            <option value="">{tx("tradeChooseCustomer", "Choose a customer")}</option>
            {(customers.data ?? []).map((customer) => <option key={customer.id} value={customer.id}>{customer.legal_name}</option>)}
          </Select>
        </Field>
        <Field label={tx("tradeCaseId", "Operation id")}><Input dir="ltr" value={linkedCase} disabled={issued} onChange={(event) => setLinkedCase(event.target.value)} /></Field>
        <Field label={tx("invoiceNumber", "Invoice number")}><Input dir="ltr" value={number} disabled={issued} onChange={(event) => setNumber(event.target.value)} /></Field>
        <Field label={tx("printReference", "Print reference")}><Input dir="ltr" value={reference} disabled={issued} placeholder="EX-116" onChange={(event) => setReference(event.target.value)} /></Field>
        <Field label={tx("invoiceDate", "Invoice date")}><Input type="date" dir="ltr" value={date} disabled={issued} onChange={(event) => setDate(event.target.value)} /></Field>
        <Field label={tx("originOfGoods", "Origin of goods")}><Input dir="ltr" value={origin} disabled={issued} onChange={(event) => setOrigin(event.target.value)} /></Field>
        <Field label={tx("portOfLoading", "Port of loading")}><Input dir="ltr" value={portLoading} disabled={issued} onChange={(event) => setPortLoading(event.target.value)} placeholder="Alexandria" /></Field>
        <Field label={tx("portOfDischarge", "Port of discharge")}><Input dir="ltr" value={portDischarge} disabled={issued} onChange={(event) => setPortDischarge(event.target.value)} placeholder="Jeddah" /></Field>
        <Field label={tx("paymentTerm", "Payment term")}>
          <Select value={paymentCode} disabled={issued} onChange={(event) => setPaymentCode(event.target.value)}>
            {["TT", "LC", "DP", "DA", "OTHER"].map((code) => <option key={code}>{code}</option>)}
          </Select>
        </Field>
        <PaymentTermField value={paymentLabel} disabled={issued} onChange={setPaymentLabel} />
        <ShippingMethodField value={shipping} disabled={issued} onChange={setShipping} />
        <Field label={tx("seaFreight", "Sea freight")}><Input dir="ltr" value={freight} disabled={issued} onChange={(event) => setFreight(event.target.value)} /></Field>
        <Field label={tx("tradeBank", "Bank account")}>
          <Select value={bankId} disabled={issued} onChange={(event) => setBankId(event.target.value)}>
            <option value="">{tx("tradeNoBank", "No bank account")}</option>
            {(banks.data ?? []).map((bank) => <option key={bank.id} value={bank.id}>{bank.account_name}</option>)}
          </Select>
        </Field>
        <div className="flex flex-wrap items-end gap-2 rounded-control border border-line bg-paper p-3 md:col-span-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setCompanyOpen(true)}>{tx("tradeCompanyDialog", "Company and bank")}</Button>
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
          <Button type="button" size="sm" variant="outline" disabled={issued} onClick={() => setCatalogOpen(true)}>{tx("tradeManageCatalog", "Manage catalog")}</Button>
        </div>
        {lines.map((line) => (
          <div key={line.key} className="grid gap-2 rounded-control border border-line bg-paper/70 p-3 md:col-span-2 md:grid-cols-6">
            <div className="md:col-span-2"><Field label={tx("description", "Description")}><Textarea className="min-h-16" value={line.description} disabled={issued} onChange={(event) => setLines((current) => current.map((item) => item.key === line.key ? { ...item, description: event.target.value } : item))} /></Field></div>
            <Field label={tx("unit", "Unit")}><Input value={line.unit} disabled={issued} onChange={(event) => setLines((current) => current.map((item) => item.key === line.key ? { ...item, unit: event.target.value } : item))} /></Field>
            <Field label={tx("quantity", "Quantity")}><Input dir="ltr" value={line.quantity} disabled={issued} onChange={(event) => setLines((current) => current.map((item) => item.key === line.key ? { ...item, quantity: event.target.value } : item))} /></Field>
            <Field label={tx("price", "Price")}><Input dir="ltr" value={line.price} disabled={issued} onChange={(event) => setLines((current) => current.map((item) => item.key === line.key ? { ...item, price: event.target.value } : item))} /></Field>
            <Field label={tx("amount", "Amount")}><Input dir="ltr" readOnly value={moneyText(lineAmount(line, "USD"))} /></Field>
            <div className="flex items-end gap-2">
              <Button type="button" size="sm" variant="outline" disabled={issued} onClick={() => setLines((current) => current.length === 1 ? [{ key: newKey(), description: "", hsCode: "", barcode: "", unit: "PCS", quantity: "1", price: "0.00" }] : current.filter((item) => item.key !== line.key))}>{tx("tradeRemoveLine", "Remove line")}</Button>
              <Button type="button" size="sm" variant="outline" disabled={issued || !line.description.trim()} onClick={() => void saveLineToCatalog(line).then(() => { notifySuccess(tx("tradePresetSaved", "Catalog item saved")); return client.invalidateQueries({ queryKey: ["product-presets"] }); }).catch(notifyError)}>{tx("tradeSaveLineCatalog", "Save to catalog")}</Button>
            </div>
          </div>
        ))}
        <p className="text-sm font-medium text-ink md:col-span-2" dir="ltr">TOTAL FOB {moneyText(fob)}{freightOn ? ` + SEA FREIGHT ${moneyText(freightMinor)} = TOTAL ${shipping} ${moneyText(fob + freightMinor)}` : ""}</p>
        <div className="md:col-span-2">
          <PrintFieldsPanel customerId={customerId} fields={printFields} disabled={issued} document={{ date, invoiceNumber: number, reference }} onChange={setPrintFields} />
        </div>
        <div className="md:col-span-2">
          <h2 className="mb-2 text-sm font-semibold text-ink">{tx("tradeLiveView", "Live view and stamp")}</h2>
          <LiveInvoiceView model={proformaLiveModel()} stamp={stamp} disabled={issued} onChange={setStamp} />
        </div>
        <div className="flex flex-wrap gap-2 md:col-span-2">
          <Button type="button" disabled={issued || busy} onClick={() => void save()}>{tx("tradeSaveDraft", "Save draft")}</Button>
          {initial?.id ? <Button type="button" variant="outline" disabled={issued || busy} onClick={() => void issue()}>{tx("proformaIssue", "Issue proforma")}</Button> : null}
          {initial?.id ? <Button type="button" size="sm" variant="outline" onClick={() => {
            const customer = (customers.data ?? []).find((item) => item.id === customerId);
            void downloadPdf(`/api/v1/proformas/${initial.id}/pdf`, tradePdfFilename({
              invoiceNumber: number,
              clientName: customer?.legal_name ?? "CLIENT",
              clientCode: customer?.customer_code ?? reference ?? "NA",
              country: customer?.country_code ?? "NA",
            })).catch((error) => notifyError(error));
          }}>{tx("proformaDownload", "Download proforma PDF")}</Button> : null}
          {initial?.id ? <Button type="button" size="sm" variant="outline" disabled={busy || !linkedCase} onClick={() => void convert()}>{tx("proformaConvert", "Convert to commercial invoice")}</Button> : null}
        </div>
      </div>
      <CompanyDialog open={companyOpen} onClose={() => setCompanyOpen(false)} />
      <CatalogDialog open={catalogOpen} onClose={() => setCatalogOpen(false)} />
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
