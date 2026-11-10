import { History, LockKeyhole, LockOpen, ReceiptText } from "lucide-react";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { FormDisclosure } from "@/components/ui/form-disclosure";
import { EmptyState, Ltr } from "@/components/ui/chrome";
import { Field, Input, Select } from "@/components/ui/input";
import { SkeletonText } from "@/components/ui/skeleton";
import { can, useSession } from "@/app/access";
import { CustomFieldsPanel } from "@/features/fields/CustomFieldsPanel";
import { api } from "@/lib/api";
import { isDefinitiveFailure, useIdempotencyKey } from "@/lib/idempotency";
import { notifyError, notifySuccess } from "@/lib/notify";
import { useCopy } from "@/lib/copy";
import { cn, formatMoney, gramsLabel } from "@/lib/utils";
import { commercialInvoiceTotal, minorToDecimalString } from "@shared/money";

import { formatWhen } from "./case-format";
import { TradeBuilder } from "@/features/trade/TradeBuilder";
import { downloadPdf } from "@/features/trade/trade-model";
import { tradePdfFilename } from "@shared/trade-sheet";
import { Link } from "react-router";

export function InvoicePanel({ invoices, bookings = [], caseStatus, caseId, containers = [], customerId = "", customerName = "", customerCode = "", customerCountry = "", onDone }: { invoices: Array<Record<string, string | number>>; bookings?: Array<Record<string, string | number>>; caseStatus: string; caseId: string; containers?: Array<Record<string, string | number>>; customerId?: string; customerName?: string; customerCode?: string; customerCountry?: string; onDone?: () => void }) {
  const { tx } = useCopy();
  const user = useSession();
  const locked = caseStatus === "COMPLETED";
  const canEdit = can(user, "invoices.edit");
  const canCorrect = can(user, "invoices.correct_completed");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      {locked ? (
        <div className="flex items-start gap-3 rounded-card border border-warn/30 bg-warn/[0.06] px-4 py-3" role="status">
          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-warn/15 text-warn" aria-hidden>
            <LockKeyhole className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">{tx("invoiceLockedTitle", "Invoice locked")}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{tx("invoiceLocked", "This invoice is locked because the export operation is completed. A permitted user can open it, edit it, then lock it again.")}</p>
          </div>
        </div>
      ) : (
        <p className="text-xs leading-relaxed text-ink-muted">{tx("invoiceOpenHint", "Each export operation has one invoice. Add it after the case is created, then edit it while the operation is still a draft or active.")}</p>
      )}
      {!locked && canEdit && invoices.length === 0 ? (
        <FormDisclosure
          open={adding}
          onToggle={() => setAdding((open) => !open)}
          title={tx("addInvoice", "Add invoice")}
          hint={tx("commercialTotalHint", "The commercial total is goods plus the freight written on the invoice. Actual freight is an internal cost and is not added. On FOB, leave invoiced freight at zero.")}
          openLabel={tx("addInvoice", "Add invoice")}
          closeLabel={tx("cancel", "Cancel")}
        >
          <AddInvoiceForm caseId={caseId} onDone={() => { setAdding(false); onDone?.(); }} />
        </FormDisclosure>
      ) : null}
      {canEdit ? <p className="text-sm"><Link className="font-medium text-accent" to={`/proformas/new?caseId=${caseId}`}>{tx("proformaFromCase", "Create a proforma for this operation")}</Link></p> : null}
      {invoices.map((inv) => {
        const decimals = Number(inv.currency_decimals);
        const currency = String(inv.currency);
        const money = (value: string | number) => formatMoney(value, decimals, currency);
        return (
          <section key={String(inv.id)} className="overflow-hidden rounded-card border border-line bg-card shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-paper/50 px-4 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-control bg-accent/10 text-accent" aria-hidden>
                  <ReceiptText className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink"><Ltr>{String(inv.invoice_number)}</Ltr></p>
                  <p className="text-[11px] text-ink-muted"><Ltr>{String(inv.incoterm)} {String(inv.incoterms_edition)}</Ltr></p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="rounded-full border border-line bg-card px-2 py-0.5 text-[11px] font-semibold text-ink-muted"><Ltr>{currency}</Ltr></span>
                {locked && Number(inv.edit_open) === 1 ? (
                  <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent">{tx("invoiceEditOpen", "Open for editing")}</span>
                ) : null}
                {locked && Number(inv.edit_open) !== 1 ? (
                  <span className="rounded-full bg-warn/15 px-2 py-0.5 text-[11px] font-semibold text-warn">{tx("invoiceLockedBadge", "Locked")}</span>
                ) : null}
              </div>
            </div>
            <div className="grid gap-3 border-b border-line px-4 py-3 text-sm md:grid-cols-6">
              <div>
                <p className="text-[11px] text-ink-muted">{tx("customer", "Customer")}</p>
                <p className="font-medium text-ink">{customerName || "—"} {customerCode ? <span className="rounded-full bg-accent/10 px-1.5 py-0.5 text-[11px] font-semibold text-accent" dir="ltr">{customerCode}</span> : null}</p>
              </div>
              <div>
                <p className="text-[11px] text-ink-muted">{tx("invoiceNumber", "Invoice")}</p>
                <p className="font-medium text-ink"><Ltr>{String(inv.invoice_number)}</Ltr></p>
                <p className="text-[11px] text-ink-muted"><Ltr>{String(inv.invoice_date ?? "")}</Ltr></p>
              </div>
              <div>
                <p className="text-[11px] text-ink-muted">{tx("shippingMethod", "Shipping")}</p>
                <p><span className="rounded-full border border-line px-1.5 py-0.5 text-[11px] font-semibold" dir="ltr">{String(inv.shipping_method_label || inv.incoterm || "—")}</span></p>
                <p className="text-[11px] text-ink-muted"><Ltr>{money(inv.invoiced_freight_minor)}</Ltr></p>
              </div>
              <div>
                <p className="text-[11px] text-ink-muted">{tx("tradeBeforeFreight", "Before freight")}</p>
                <p className="tabular-nums text-ink"><Ltr>{money(inv.goods_value_minor)}</Ltr></p>
              </div>
              <div>
                <p className="text-[11px] text-ink-muted">{tx("tradeAfterFreight", "After freight")}</p>
                <p className="text-base font-semibold tabular-nums text-ink"><Ltr>{money(inv.invoice_total_minor)}</Ltr></p>
              </div>
              <div className="flex flex-wrap items-end gap-1">
                <span className="rounded-full bg-paper px-2 py-0.5 text-[11px] font-semibold text-ink">{String(inv.trade_status || "DRAFT")}{Number(inv.is_stamped) === 1 ? ` · ${tx("tradeStamped", "Stamped")}` : ""}</span>
                <Button type="button" size="sm" variant="outline" onClick={() => void downloadPdf(`/api/v1/invoices/${String(inv.id)}/commercial-pdf`, tradePdfFilename({ invoiceNumber: String(inv.invoice_number), clientName: customerName || "CLIENT", clientCode: customerCode || "NA", country: customerCountry || "NA" })).catch(notifyError)}>{tx("pdf", "PDF")}</Button>
              </div>
            </div>
            <dl className="grid gap-2 px-4 py-3 sm:grid-cols-2 xl:grid-cols-4">
              <MoneyTile label={tx("goodsLabel", "Goods")} value={money(inv.goods_value_minor)} />
              <MoneyTile label={tx("invoicedFreightLabel", "Invoiced freight")} value={money(inv.invoiced_freight_minor)} />
              <MoneyTile label={tx("actualFreightLabel", "Actual freight expense")} value={money(inv.actual_freight_expense_minor)} />
              <MoneyTile label={tx("invoiceTotalLabel", "Invoice total")} value={money(inv.invoice_total_minor)} emphasis />
            </dl>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-line px-4 py-2 text-xs text-ink-muted">
              <span>{tx("grossLabel", "Gross")} <span className="font-semibold text-ink tabular-nums"><Ltr>{gramsLabel(Number(inv.gross_weight_grams))}</Ltr></span></span>
              <span>{tx("netLabel", "Net")} <span className="font-semibold text-ink tabular-nums"><Ltr>{gramsLabel(Number(inv.net_weight_grams))}</Ltr></span></span>
            </div>
            {locked && canCorrect ? (
              <div className="flex justify-end border-t border-line px-4 py-3">
                <EditWindowButton invoice={inv} open={Number(inv.edit_open) === 1} onDone={onDone} />
              </div>
            ) : null}
            <div className="border-t border-line px-4 py-3">
              <RevisionList invoiceId={String(inv.id)} />
            </div>
            <div className="border-t border-line px-4 py-3">
              <TradeBuilder
                invoiceId={String(inv.id)}
                caseId={caseId}
                currency={currency}
                canEdit={canEdit && (!locked || Number(inv.edit_open) === 1)}
                customerCode={customerCode}
                customerId={customerId}
                invoiceDate={String(inv.invoice_date ?? "")}
                customerName={customerName}
                customerCountry={customerCountry}
                invoiceNumber={String(inv.invoice_number)}
                bookings={bookings.map((b) => ({
                  id: String(b.id),
                  booking_number: b.booking_number == null ? undefined : String(b.booking_number),
                  status: b.status == null ? undefined : String(b.status),
                  version: b.version == null ? undefined : Number(b.version),
                }))}
                containers={containers.map((item) => ({
                  id: String(item.id),
                  slot_index: Number(item.slot_index),
                  official_number: item.official_number == null ? null : String(item.official_number),
                  status: item.status == null ? undefined : String(item.status),
                  version: item.version == null ? undefined : Number(item.version),
                }))}
              />
            </div>
            {(!locked && canEdit) || (locked && canCorrect && Number(inv.edit_open) === 1) ? (
              <div className="border-t border-line px-4 py-4">
                <FormDisclosure
                  embedded
                  open={editingId === String(inv.id)}
                  onToggle={() => setEditingId((current) => current === String(inv.id) ? null : String(inv.id))}
                  title={tx("editInvoice", "Edit invoice")}
                  hint={tx("commercialTotalHint", "The commercial total is goods plus the freight written on the invoice. Actual freight is an internal cost and is not added. On FOB, leave invoiced freight at zero.")}
                  openLabel={tx("editInvoice", "Edit invoice")}
                  closeLabel={tx("cancel", "Cancel")}
                >
                  <InvoiceWriteForm invoice={inv} mode="edit" onDone={() => { setEditingId(null); onDone?.(); }} />
                </FormDisclosure>
              </div>
            ) : null}
            <div className="border-t border-line px-4 py-3">
              <CustomFieldsPanel endpoint={`/api/v1/invoices/${String(inv.id)}/custom-fields`} locked={locked && !(canCorrect && Number(inv.edit_open) === 1)} />
            </div>
          </section>
        );
      })}
      {!invoices.length ? <EmptyState>{tx("noInvoices", "No invoices on this case yet.")}</EmptyState> : null}
    </div>
  );
}

function InvoiceWriteForm({
  invoice,
  mode,
  onDone,
}: {
  invoice: Record<string, string | number>;
  mode: "edit" | "correct";
  onDone?: () => void;
}) {
  const { tx, fail } = useCopy();
  const client = useQueryClient();
  const decimals = Number(invoice.currency_decimals);
  const currency = String(invoice.currency);
  const [invoiceNumber, setInvoiceNumber] = useState(String(invoice.invoice_number));
  const [goods, setGoods] = useState(minorToDecimalString(invoice.goods_value_minor, decimals));
  const [freight, setFreight] = useState(minorToDecimalString(invoice.invoiced_freight_minor, decimals));
  const [actual, setActual] = useState(minorToDecimalString(invoice.actual_freight_expense_minor, decimals));
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState(String(invoice.notes ?? ""));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const total = commercialInvoiceTotal(goods, freight, currency);
  return (
    <form
      className="grid gap-3"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!total || saving) return;
        setSaving(true);
        setError("");
        const body = {
          version: invoice.version,
          invoiceNumber,
          invoiceDate: invoice.invoice_date,
          paymentTermCode: invoice.payment_term_code,
          incoterm: invoice.incoterm,
          currency: invoice.currency,
          goodsValue: goods,
          invoicedFreight: freight || "0",
          actualFreightExpense: actual || "0",
          invoiceTotal: total,
          grossWeight: Number(invoice.gross_weight_grams) / 1000,
          netWeight: Number(invoice.net_weight_grams) / 1000,
          weightUnit: "KG",
          portOfLoading: invoice.port_of_loading || undefined,
          portOfDischarge: invoice.port_of_discharge || undefined,
          notes,
          reason: mode === "correct" ? reason : undefined,
        };
        try {
          await api(mode === "correct" ? `/api/v1/invoices/${String(invoice.id)}/corrections` : `/api/v1/invoices/${String(invoice.id)}`, {
            method: mode === "correct" ? "POST" : "PUT",
            body: JSON.stringify(body),
          });
          notifySuccess(tx(mode === "correct" ? "invoiceCorrected" : "invoiceSaved", mode === "correct" ? "Invoice corrected" : "Invoice saved"));
          await client.invalidateQueries({ queryKey: ["revisions", String(invoice.id)] });
          onDone?.();
        } catch (caught) {
          setError(fail(caught));
        } finally {
          setSaving(false);
        }
      }}
    >
      <div className="grid gap-3">
        {mode === "correct" ? <h3 className="text-sm font-semibold text-ink">{tx("exceptionalCorrection", "Exceptional correction")}</h3> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={tx("invoiceNumber", "Invoice number")}>
            <Input name="invoiceNumber" dir="ltr" required value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} />
          </Field>
          <Field label={tx("goodsLabel", "Goods")}>
            <Input name="goodsValue" dir="ltr" inputMode="decimal" required value={goods} onChange={(event) => setGoods(event.target.value)} />
          </Field>
          <Field label={tx("invoicedFreightLabel", "Invoiced freight")}>
            <Input name="invoicedFreight" dir="ltr" inputMode="decimal" value={freight} onChange={(event) => setFreight(event.target.value)} />
          </Field>
          <Field label={tx("actualFreightLabel", "Actual freight expense")}>
            <Input name="actualFreightExpense" dir="ltr" inputMode="decimal" value={actual} onChange={(event) => setActual(event.target.value)} />
          </Field>
          <Field label={tx("invoiceTotalLabel", "Invoice total")}>
            <Input name="invoiceTotal" dir="ltr" readOnly tabIndex={-1} value={total} />
          </Field>
          {mode === "correct" ? (
            <div className="sm:col-span-2">
              <Field label={tx("correctionReason", "Correction reason")}>
                <Input name="reason" required minLength={3} value={reason} onChange={(event) => setReason(event.target.value)} />
              </Field>
            </div>
          ) : null}
          <div className="sm:col-span-2">
            <Field label={tx("notes", "Notes")}>
              <Input name="notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
            </Field>
          </div>
        </div>
        {error ? <p role="alert" className="mt-2 text-sm text-danger">{error}</p> : null}
        <div className="mt-3 flex justify-end">
          <Button type="submit" size="sm" disabled={saving || !total}>
            {mode === "correct" ? tx("exceptionalCorrection", "Exceptional correction") : tx("saveInvoice", "Save invoice")}
          </Button>
        </div>
      </div>
    </form>
  );
}

function MoneyTile({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className={cn("rounded-xl border px-3 py-2.5", emphasis ? "border-accent/30 bg-accent/[0.06]" : "border-line bg-paper/40")}>
      <dt className="text-[11px] font-semibold text-ink-muted">{label}</dt>
      <dd className={cn("mt-1 text-sm font-semibold tabular-nums", emphasis ? "text-accent" : "text-ink")}>
        <Ltr>{value}</Ltr>
      </dd>
    </div>
  );
}

function EditWindowButton({ invoice, open, onDone }: { invoice: Record<string, string | number>; open: boolean; onDone?: () => void }) {
  const { tx, fail } = useCopy();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        type="button"
        size="sm"
        variant={open ? "outline" : "default"}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await api(`/api/v1/invoices/${String(invoice.id)}/edit-window`, {
              method: "POST",
              body: JSON.stringify({ open: !open, version: Number(invoice.version) }),
            });
            notifySuccess(tx(open ? "invoiceLockedAgain" : "invoiceOpened", open ? "Invoice locked" : "Invoice opened for editing"));
            await client.invalidateQueries({ queryKey: ["revisions", String(invoice.id)] });
            onDone?.();
          } catch (caught) {
            setError(fail(caught));
          } finally {
            setBusy(false);
          }
        }}
      >
        {open ? <LockKeyhole className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
        {open ? tx("lockInvoice", "Lock invoice") : tx("openInvoice", "Open for editing")}
      </Button>
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
    </div>
  );
}

function AddInvoiceForm({ caseId, onDone }: { caseId: string; onDone?: () => void }) {
  const { tx, fail } = useCopy();
  const [goods, setGoods] = useState("");
  const [freight, setFreight] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const { key, reset: resetKey } = useIdempotencyKey();
  const total = commercialInvoiceTotal(goods, freight, currency);
  return (
    <form
      className="grid gap-3"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!total || saving) return;
        const form = new FormData(event.currentTarget);
        setSaving(true);
        setError("");
        try {
          await api(`/api/v1/export-cases/${caseId}/invoices`, {
            method: "POST",
            idempotencyKey: key.current,
            body: JSON.stringify({
              invoiceNumber: form.get("invoiceNumber"),
              invoiceDate: form.get("invoiceDate"),
              paymentTermCode: form.get("paymentTermCode"),
              paymentTermDetails: form.get("paymentTermDetails") || undefined,
              incoterm: form.get("incoterm"),
              namedPlace: form.get("namedPlace") || undefined,
              currency,
              goodsValue: goods,
              invoicedFreight: freight || "0",
              actualFreightExpense: String(form.get("actualFreightExpense") || "0"),
              invoiceTotal: total,
              portOfLoading: form.get("portOfLoading") || undefined,
              portOfDischarge: form.get("portOfDischarge") || undefined,
              grossWeight: Number(form.get("grossWeight")),
              netWeight: Number(form.get("netWeight")),
              weightUnit: "KG",
              notes: form.get("notes") || undefined,
            }),
          });
          notifySuccess(tx("invoiceAdded", "Invoice added"));
          resetKey();
          onDone?.();
        } catch (caught) {
          if (isDefinitiveFailure(caught)) resetKey();
          setError(fail(caught));
        } finally {
          setSaving(false);
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={tx("invoiceNumber", "Invoice number")}><Input name="invoiceNumber" required dir="ltr" /></Field>
        <Field label={tx("invoiceDate", "Invoice date")}><Input name="invoiceDate" type="date" required dir="ltr" /></Field>
        <Field label={tx("incoterm", "Incoterm")}>
          <Select name="incoterm" defaultValue="FOB">
            <option value="FOB">FOB</option>
            <option value="CFR">CFR</option>
          </Select>
        </Field>
        <Field label={tx("namedPlace", "Named place / port")}><Input name="namedPlace" /></Field>
        <Field label={tx("paymentTerms", "Payment terms")}>
          <Select name="paymentTermCode" defaultValue="TT">
            <option value="TT">T/T</option>
            <option value="LC">L/C</option>
            <option value="DP">D/P</option>
            <option value="DA">D/A</option>
            <option value="OTHER">Other</option>
          </Select>
        </Field>
        <Field label={tx("paymentDetails", "Payment details")}><Input name="paymentTermDetails" /></Field>
        <Field label={tx("currency", "Currency")}><Input name="currency" dir="ltr" value={currency} onChange={(event) => setCurrency(event.target.value)} /></Field>
        <Field label={tx("goodsLabel", "Goods")}><Input name="goodsValue" dir="ltr" inputMode="decimal" required value={goods} onChange={(event) => setGoods(event.target.value)} /></Field>
        <Field label={tx("invoicedFreightLabel", "Invoiced freight")}><Input name="invoicedFreight" dir="ltr" inputMode="decimal" value={freight} onChange={(event) => setFreight(event.target.value)} /></Field>
        <Field label={tx("actualFreightLabel", "Actual freight expense")}><Input name="actualFreightExpense" dir="ltr" inputMode="decimal" defaultValue="0" /></Field>
        <Field label={tx("invoiceTotalLabel", "Invoice total")}><Input name="invoiceTotal" dir="ltr" readOnly tabIndex={-1} value={total} /></Field>
        <Field label={tx("portOfLoading", "Port of loading")}><Input name="portOfLoading" /></Field>
        <Field label={tx("portOfDischarge", "Port of discharge")}><Input name="portOfDischarge" /></Field>
        <Field label={tx("grossWeight", "Gross weight (kg)")}><Input name="grossWeight" type="number" step="0.001" required dir="ltr" /></Field>
        <Field label={tx("netWeight", "Net weight (kg)")}><Input name="netWeight" type="number" step="0.001" required dir="ltr" /></Field>
        <div className="sm:col-span-2">
          <Field label={tx("notes", "Notes")}><Input name="notes" /></Field>
        </div>
      </div>
      {error ? <p role="alert" className="mt-2 text-sm text-danger">{error}</p> : null}
      <div className="mt-3 flex justify-end">
        <Button type="submit" size="sm" disabled={saving || !total}>{tx("addInvoice", "Add invoice")}</Button>
      </div>
    </form>
  );
}

function RevisionList({ invoiceId }: { invoiceId: string }) {
  const { tx } = useCopy();
  const query = useQuery({
    queryKey: ["revisions", invoiceId],
    retry: false,
    queryFn: async () => (await api<Array<Record<string, unknown>>>(`/api/v1/invoices/${invoiceId}/revisions`)).data,
  });
  if (query.isLoading) return <SkeletonText lines={2} className="mt-2" />;
  if (query.isError) return <EmptyState compact>{tx("revisionsUnavailable", "Revision history is not available on this database yet.")}</EmptyState>;
  if (!query.data?.length) return <EmptyState compact>{tx("noRevisions", "No invoice changes have been recorded yet.")}</EmptyState>;
  return (
    <div>
      <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-muted">
        <History className="h-3.5 w-3.5" aria-hidden />
        {tx("invoiceActivity", "Invoice activity")}
      </p>
      <ul className="mt-2 space-y-1.5">
        {query.data.map((row) => {
          const reason = String(row.reason ?? "");
          const reasonLabel = reason === "EDIT" ? tx("invoiceEdited", "Invoice edited") : reason === "OPEN" ? tx("invoiceOpened", "Opened for editing") : reason === "LOCK" ? tx("invoiceLockedAgain", "Invoice locked") : reason;
          const changes = Array.isArray(row.changes) ? row.changes as Array<{ field: string; before: string; after: string }> : [];
          return (
            <li key={String(row.id)} className="rounded-lg border border-line bg-paper/40 px-3 py-2 text-xs">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="font-medium text-ink">{reasonLabel}</span>
                <span className="text-ink-muted">{row.actor_name ? String(row.actor_name) : tx("unknownActor", "Unknown user")}</span>
                <span className="text-ink-muted tabular-nums"><Ltr>{formatWhen(String(row.created_at))}</Ltr></span>
              </div>
              {changes.length ? (
                <ul className="mt-2 space-y-1">
                  {changes.map((change) => (
                    <li key={change.field} className="text-ink-muted">
                      <span className="font-medium text-ink">{tx(`invoiceField.${change.field}`, change.field)}</span>
                      {": "}
                      {tx("changedFrom", "from")} <Ltr>{shownChange(change.field, change.before, tx)}</Ltr>
                      {" "}
                      {tx("changedTo", "to")} <Ltr>{shownChange(change.field, change.after, tx)}</Ltr>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function shownChange(field: string, value: string, tx: (key: string, fallback: string) => string) {
  if (!value) return "—";
  if (field === "edit_open") return value === "1" ? tx("invoiceEditOpen", "Open for editing") : tx("invoiceLockedBadge", "Locked");
  return value;
}
