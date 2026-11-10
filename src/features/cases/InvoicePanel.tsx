import { ChevronDown, History, LockKeyhole, LockOpen } from "lucide-react";
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
import { notifySuccess } from "@/lib/notify";
import { useCopy } from "@/lib/copy";
import { commercialInvoiceTotal } from "@shared/money";

import { formatWhen } from "./case-format";
import { TradeBuilder } from "@/features/trade/TradeBuilder";

export function InvoicePanel({
  invoices,
  bookings = [],
  caseStatus,
  caseId,
  containers = [],
  customerId = "",
  customerName = "",
  customerCode = "",
  customerCountry = "",
  onDone,
}: {
  invoices: Array<Record<string, string | number>>;
  bookings?: Array<Record<string, string | number>>;
  caseStatus: string;
  caseId: string;
  containers?: Array<Record<string, string | number>>;
  customerId?: string;
  customerName?: string;
  customerCode?: string;
  customerCountry?: string;
  onDone?: () => void;
}) {
  const { tx } = useCopy();
  const user = useSession();
  const locked = caseStatus === "COMPLETED";
  const canEdit = can(user, "invoices.edit");
  const canCorrect = can(user, "invoices.correct_completed");
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-4">
      {!locked && canEdit && invoices.length === 0 ? (
        <FormDisclosure
          open={adding}
          onToggle={() => setAdding((open) => !open)}
          title={tx("addInvoice", "إضافة فاتورة العملية")}
          hint={tx(
            "commercialTotalHint",
            "الإجمالي التجاري هو قيمة البضاعة مضافاً إليها النولون المكتوب على الفاتورة. بعد إنشاء الفاتورة ستفتح مساحة العمل الموحدة للفواتير وبيان العبوة.",
          )}
          openLabel={tx("addInvoice", "إضافة فاتورة")}
          closeLabel={tx("cancel", "إلغاء")}
        >
          <AddInvoiceForm
            caseId={caseId}
            onDone={() => {
              setAdding(false);
              onDone?.();
            }}
          />
        </FormDisclosure>
      ) : null}

      {invoices.map((inv) => {
        const currency = String(inv.currency || "USD");
        const isEditOpen = Number(inv.edit_open) === 1;
        return (
          <div key={String(inv.id)} className="space-y-4">
            {locked ? (
              <div
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warn/30 bg-warn/[0.06] px-4 py-2.5"
                role="status"
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-warn/15 text-warn"
                    aria-hidden
                  >
                    <LockKeyhole className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-xs font-semibold text-ink">
                      {isEditOpen
                        ? tx("invoiceEditOpen", "نافذة التعديل الاستثنائية مفتوحة لهذه الفاتورة")
                        : tx("invoiceLockedTitle", "الفاتورة مقفلة لاكتمال العملية التصديرية")}
                    </p>
                    <p className="text-[11px] text-ink-muted">
                      {tx(
                        "invoiceLocked",
                        "يمكن للمستخدم المفوّض فتح نافذة التعديل مؤقتاً ثم إعادة قفل الفاتورة بعد الحفظ.",
                      )}
                    </p>
                  </div>
                </div>
                {canCorrect ? <EditWindowButton invoice={inv} open={isEditOpen} onDone={onDone} /> : null}
              </div>
            ) : null}

            {/* Unified Tabbed Trade Workspace (includes Executive KPI Strip + 4-Col Reconciliation Matrix + 4 Tabs + Sticky Action Bar) */}
            <TradeBuilder
              invoiceId={String(inv.id)}
              caseId={caseId}
              currency={currency}
              canEdit={canEdit && (!locked || isEditOpen)}
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

            {/* Secondary Metadata & Audit History (Collapsed by default to eliminate clutter) */}
            <details className="group overflow-hidden rounded-xl border border-line bg-card shadow-2xs">
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 text-xs font-semibold text-ink-muted transition-colors hover:bg-paper/60 hover:text-ink">
                <span className="inline-flex items-center gap-1.5">
                  <History className="h-3.5 w-3.5 text-accent" />
                  {tx("invoiceExtraAndHistory", "الحقول المخصصة الإضافية وسجل تعديلات الفاتورة")}
                </span>
                <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
              </summary>
              <div className="space-y-4 border-t border-line p-4">
                <CustomFieldsPanel
                  endpoint={`/api/v1/invoices/${String(inv.id)}/custom-fields`}
                  locked={locked && !(canCorrect && isEditOpen)}
                />
                <div className="border-t border-line pt-3">
                  <RevisionList invoiceId={String(inv.id)} />
                </div>
              </div>
            </details>
          </div>
        );
      })}

      {!invoices.length ? <EmptyState>{tx("noInvoices", "لا توجد فاتورة مسجلة على هذه العملية بعد.")}</EmptyState> : null}
    </div>
  );
}

function EditWindowButton({
  invoice,
  open,
  onDone,
}: {
  invoice: Record<string, string | number>;
  open: boolean;
  onDone?: () => void;
}) {
  const { tx, fail } = useCopy();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="flex flex-col items-end gap-1">
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
            notifySuccess(tx(open ? "invoiceLockedAgain" : "invoiceOpened", open ? "تم قفل الفاتورة" : "تم فتح الفاتورة للتعديل"));
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
        {open ? tx("lockInvoice", "قفل الفاتورة") : tx("openInvoice", "فتح للتعديل")}
      </Button>
      {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
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
          notifySuccess(tx("invoiceAdded", "تمت إضافة الفاتورة"));
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
      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
        <Field label={tx("invoiceNumber", "رقم الفاتورة")}><Input name="invoiceNumber" required dir="ltr" /></Field>
        <Field label={tx("invoiceDate", "تاريخ الفاتورة")}><Input name="invoiceDate" type="date" required dir="ltr" /></Field>
        <Field label={tx("incoterm", "Incoterm")}>
          <Select name="incoterm" defaultValue="FOB">
            <option value="FOB">FOB</option>
            <option value="CFR">CFR</option>
          </Select>
        </Field>
        <Field label={tx("namedPlace", "الميناء / المكان المسمى")}><Input name="namedPlace" /></Field>
        <Field label={tx("paymentTerms", "شروط الدفع")}>
          <Select name="paymentTermCode" defaultValue="TT">
            <option value="TT">T/T</option>
            <option value="LC">L/C</option>
            <option value="DP">D/P</option>
            <option value="DA">D/A</option>
            <option value="OTHER">Other</option>
          </Select>
        </Field>
        <Field label={tx("paymentDetails", "تفاصيل الدفع")}><Input name="paymentTermDetails" /></Field>
        <Field label={tx("currency", "العملة")}><Input name="currency" dir="ltr" value={currency} onChange={(event) => setCurrency(event.target.value)} /></Field>
        <Field label={tx("goodsLabel", "قيمة البضاعة")}><Input name="goodsValue" dir="ltr" inputMode="decimal" required value={goods} onChange={(event) => setGoods(event.target.value)} /></Field>
        <Field label={tx("invoicedFreightLabel", "الشحن المفوتر")}><Input name="invoicedFreight" dir="ltr" inputMode="decimal" value={freight} onChange={(event) => setFreight(event.target.value)} /></Field>
        <Field label={tx("actualFreightLabel", "مصروف الشحن الفعلي")}><Input name="actualFreightExpense" dir="ltr" inputMode="decimal" defaultValue="0" /></Field>
        <Field label={tx("invoiceTotalLabel", "إجمالي الفاتورة")}><Input name="invoiceTotal" dir="ltr" readOnly tabIndex={-1} value={total} /></Field>
        <Field label={tx("portOfLoading", "ميناء الشحن")}><Input name="portOfLoading" /></Field>
        <Field label={tx("portOfDischarge", "ميناء الوصول")}><Input name="portOfDischarge" /></Field>
        <Field label={tx("grossWeight", "الوزن القائم (kg)")}><Input name="grossWeight" type="number" step="0.001" required dir="ltr" /></Field>
        <Field label={tx("netWeight", "الوزن الصافي (kg)")}><Input name="netWeight" type="number" step="0.001" required dir="ltr" /></Field>
        <Field label={tx("notes", "ملاحظات")}><Input name="notes" /></Field>
      </div>
      {error ? <p role="alert" className="mt-2 text-sm text-danger">{error}</p> : null}
      <div className="mt-3 flex justify-end">
        <Button type="submit" size="sm" disabled={saving || !total}>{tx("addInvoice", "إضافة الفاتورة")}</Button>
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
  if (query.isError) return <EmptyState compact>{tx("revisionsUnavailable", "سجل التعديلات غير متاح حالياً.")}</EmptyState>;
  if (!query.data?.length) return <EmptyState compact>{tx("noRevisions", "لم يتم تسجيل تعديلات سابقة على هذه الفاتورة.")}</EmptyState>;
  return (
    <div>
      <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-muted">
        <History className="h-3.5 w-3.5" aria-hidden />
        {tx("invoiceActivity", "سجل نشاط الفاتورة")}
      </p>
      <ul className="mt-2 space-y-1.5">
        {query.data.map((row) => {
          const reason = String(row.reason ?? "");
          const reasonLabel =
            reason === "EDIT"
              ? tx("invoiceEdited", "تعديل الفاتورة")
              : reason === "OPEN"
                ? tx("invoiceOpened", "فتح للتعديل")
                : reason === "LOCK"
                  ? tx("invoiceLockedAgain", "قفل الفاتورة")
                  : reason;
          const changes = Array.isArray(row.changes) ? (row.changes as Array<{ field: string; before: string; after: string }>) : [];
          return (
            <li key={String(row.id)} className="rounded-lg border border-line bg-paper/40 px-3 py-2 text-xs">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="font-medium text-ink">{reasonLabel}</span>
                <span className="text-ink-muted">{row.actor_name ? String(row.actor_name) : tx("unknownActor", "مستخدم")}</span>
                <span className="text-ink-muted tabular-nums"><Ltr>{formatWhen(String(row.created_at))}</Ltr></span>
              </div>
              {changes.length ? (
                <ul className="mt-2 space-y-1">
                  {changes.map((change) => (
                    <li key={change.field} className="text-ink-muted">
                      <span className="font-medium text-ink">{tx(`invoiceField.${change.field}`, change.field)}</span>
                      {": "}
                      {tx("changedFrom", "من")} <Ltr>{shownChange(change.field, change.before, tx)}</Ltr>{" "}
                      {tx("changedTo", "إلى")} <Ltr>{shownChange(change.field, change.after, tx)}</Ltr>
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
  if (field === "edit_open") return value === "1" ? tx("invoiceEditOpen", "مفتوحة للتعديل") : tx("invoiceLockedBadge", "مقفلة");
  return value;
}
