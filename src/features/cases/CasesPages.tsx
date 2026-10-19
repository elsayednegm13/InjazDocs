import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { AlertText, DualLane, EmptyState, Ltr, PageHeader } from "@/components/ui/chrome";
import { Field, Input, Select } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status";
import { can, useSession } from "@/app/access";
import { CustomFieldsPanel } from "@/features/fields/CustomFieldsPanel";
import { api, uploadFile } from "@/lib/api";
import { fieldErrorsOf } from "@/lib/fail";
import { notifyError, notifySuccess } from "@/lib/notify";
import { useCopy } from "@/lib/copy";
import { formatMoney, gramsLabel } from "@/lib/utils";
import { minorToDecimalString } from "@shared/money";

function formatWhen(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const locale = document.documentElement.lang.startsWith("ar") ? "ar-EG" : "en-GB";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function CasesListPage() {
  const { tx, stored } = useCopy();
  const user = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const q = params.get("q") ?? "";
  const query = useQuery({
    queryKey: ["cases", q],
    queryFn: async () =>
      (await api<Array<Record<string, string>>>(`/api/v1/export-cases?q=${encodeURIComponent(q)}`)).data,
  });
  const counts = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => (await api<{ counts: Record<string, number> }>("/api/v1/dashboard")).data,
  });
  const selected = query.data?.find((row) => row.id === selectedId) ?? null;
  return (
    <div className="space-y-4" data-cases={query.isLoading ? "loading" : "ready"}>
      <PageHeader
        title={tx("exportOperations", "Export operations")}
        subtitle={tx("casesHint", "Search uses the existing server filter. Cargo completion is not a list column.")}
        actions={can(user, "export_cases.create") ? <Button asChild><Link to="/export-cases/new">{tx("newCase", "New export case")}</Link></Button> : null}
      />
      {counts.data ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-[14px] border border-line bg-card px-4 py-3 text-sm">{tx("openCases", "Open cases")} <Ltr className="block text-2xl font-semibold">{counts.data.counts.total_cases}</Ltr></div>
          <div className="rounded-[14px] border border-line bg-card px-4 py-3 text-sm">{tx("completedCases", "Completed cases")} <Ltr className="block text-2xl font-semibold">{counts.data.counts.completed}</Ltr></div>
          <div className="rounded-[14px] border border-line bg-card px-4 py-3 text-sm">{tx("docsPending", "Documents pending")} <Ltr className="block text-2xl font-semibold">{counts.data.counts.docs_pending}</Ltr></div>
          <div className="rounded-[14px] border border-line bg-card px-4 py-3 text-sm">{tx("courierOpen", "Courier in transit")} <Ltr className="block text-2xl font-semibold">{counts.data.counts.courier_open}</Ltr></div>
        </div>
      ) : null}
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const next = new FormData(event.currentTarget).get("q");
          navigate(`/export-cases?q=${encodeURIComponent(String(next ?? ""))}`);
        }}
      >
        <Input name="q" defaultValue={q} aria-label={tx("search", "Search cases, invoices, customers")} className="max-w-md" />
        <Button type="submit" variant="outline">{tx("searchAction", "Search")}</Button>
      </form>
      {query.isLoading ? <p>{tx("loadingCases", "Loading cases…")}</p> : null}
      {query.isError ? <p className="text-danger">{tx("casesError", "Could not load cases.")}</p> : null}
      {!query.data?.length && !query.isLoading ? <EmptyState>{tx("noCases", "No export cases match this filter.")}</EmptyState> : null}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="grid gap-3 lg:hidden">
          {query.data?.map((row) => (
            <Link key={row.id} className="rounded-[14px] border border-line bg-card p-4 shadow-[var(--shadow-card)]" to={`/export-cases/${row.id}`}>
              <div className="flex items-start justify-between gap-2">
                <Ltr className="font-semibold text-accent">{row.case_reference}</Ltr>
                <StatusBadge value={row.status} />
              </div>
              <p className="mt-1 text-sm">{row.customer_name}</p>
              <p className="text-sm text-ink">{tx(`status.${row.document_route}`, row.document_route)}</p>
              <p className="mt-1 text-sm text-ink-muted">{stored(row.next_action)}</p>
              <p className="text-xs text-ink-muted"><Ltr>{row.invoice_numbers || "—"}</Ltr> · <Ltr>{row.destination_country || "—"}</Ltr></p>
              <div className="mt-2"><StatusBadge value={row.document_route === "BANK_ROUTE" ? row.bank_path_status : row.direct_path_status} /></div>
            </Link>
          ))}
        </div>
        <div className="hidden overflow-x-auto rounded-[14px] border border-line bg-card lg:block" aria-label={tx("exportOperations", "Export operations")}>
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-paper text-start text-xs font-semibold text-ink-muted">
              <tr>
                <th className="p-3 text-start">{tx("case", "Case")}</th>
                <th className="p-3 text-start">{tx("customer", "Customer")}</th>
                <th className="p-3 text-start">{tx("invoices", "Invoices")}</th>
                <th className="p-3 text-start">{tx("country", "Country")}</th>
                <th className="p-3 text-start">{tx("documentRoute", "Document route")}</th>
                <th className="p-3 text-start">{tx("nextAction", "Next action")}</th>
                <th className="p-3 text-start">{tx("docs", "Docs")}</th>
                <th className="p-3 text-start">{tx("goods", "Goods")}</th>
                <th className="p-3 text-start">{tx("status", "Status")}</th>
              </tr>
            </thead>
            <tbody>
              {query.data?.map((row) => (
                <tr
                  key={row.id}
                  className={`cursor-pointer border-t border-line ${selectedId === row.id ? "bg-paper" : ""}`}
                  onClick={() => setSelectedId(row.id)}
                >
                  <td className="whitespace-nowrap p-3"><Link aria-label={`${row.case_reference} ${row.customer_name}`} className="font-medium text-accent" to={`/export-cases/${row.id}`}><Ltr>{row.case_reference}</Ltr></Link></td>
                  <td className="p-3">{row.customer_name}</td>
                  <td className="p-3"><Ltr>{row.invoice_numbers || "—"}</Ltr></td>
                  <td className="p-3"><Ltr>{row.destination_country || "—"}</Ltr></td>
                  <td className="p-3">{tx(`status.${row.document_route}`, row.document_route)}</td>
                  <td className="p-3">{stored(row.next_action)}</td>
                  <td className="p-3"><StatusBadge value={row.document_route === "BANK_ROUTE" ? row.bank_path_status : row.direct_path_status} /></td>
                  <td className="p-3 text-ink-muted">{tx("goodsIndependent", "Independent of document delivery")}</td>
                  <td className="p-3"><StatusBadge value={row.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {selected ? (
          <aside className="hidden rounded-[14px] border border-line bg-card p-4 xl:block">
            <p className="text-xs text-ink-muted">{tx("casePreview", "Selected case")}</p>
            <p className="mt-1 text-lg font-semibold"><Ltr>{selected.case_reference}</Ltr></p>
            <p className="mt-2 text-sm">{selected.customer_name}</p>
            <p className="mt-1 text-sm">{tx(`status.${selected.document_route}`, selected.document_route)}</p>
            <p className="mt-2 text-sm text-ink-muted">{stored(selected.next_action)}</p>
            <p className="mt-2 text-xs text-ink-muted">{tx("noCargoKpi", "This board has no cargo-delivery total. Port arrival is not customer delivery.")}</p>
            <Button asChild className="mt-4"><Link to={`/export-cases/${selected.id}`}>{tx("openFullCase", "Open full case")}</Link></Button>
          </aside>
        ) : (
          <aside className="hidden rounded-[14px] border border-dashed border-line bg-card p-4 text-sm text-ink-muted xl:block">{tx("selectCase", "Select a case to preview fields already on this list.")}</aside>
        )}
      </div>
    </div>
  );
}

export function NewCasePage() {
  const { tx, fail } = useCopy();
  const customers = useQuery({
    queryKey: ["customers"],
    queryFn: async () => (await api<Array<Record<string, string>>>("/api/v1/customers?pageSize=100")).data,
  });
  const templates = useQuery({
    queryKey: ["templates"],
    queryFn: async () => (await api<Array<Record<string, unknown>>>("/api/v1/document-templates")).data,
  });
  const mutation = useMutation({
    mutationFn: async (form: FormData) =>
      api<{ id: string }>("/api/v1/export-cases", {
        method: "POST",
        body: JSON.stringify({
          customerId: form.get("customerId"),
          documentRoute: form.get("documentRoute"),
          destinationCountry: form.get("destinationCountry"),
          templateId: form.get("templateId") || undefined,
          invoice: form.get("invoiceNumber")
            ? {
                invoiceNumber: form.get("invoiceNumber"),
                invoiceDate: form.get("invoiceDate"),
                paymentTermCode: form.get("paymentTermCode"),
                paymentTermDetails: form.get("paymentTermDetails"),
                incoterm: form.get("incoterm"),
                namedPlace: form.get("namedPlace"),
                currency: form.get("currency"),
                goodsValue: form.get("goodsValue"),
                invoicedFreight: form.get("invoicedFreight") || "0",
                actualFreightExpense: form.get("actualFreightExpense") || "0",
                invoiceTotal: form.get("invoiceTotal"),
                portOfLoading: form.get("portOfLoading"),
                portOfDischarge: form.get("portOfDischarge"),
                grossWeight: Number(form.get("grossWeight")),
                netWeight: Number(form.get("netWeight")),
                weightUnit: "KG",
              }
            : undefined,
        }),
      }),
    onSuccess: (res) => {
      window.location.href = `/export-cases/${res.data.id}`;
    },
  });
  return (
    <form
      className="mx-auto grid max-w-4xl gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate(new FormData(event.currentTarget));
      }}
    >
      <PageHeader title={tx("newCase", "New export case")} subtitle={tx("newCaseHint", "Save a draft as soon as the customer is known. Invoice totals are entered explicitly and are never auto-equated to goods + freight expense.")} />
      <section className="grid gap-3 rounded-2xl border border-line bg-card p-4 shadow-[var(--shadow-card)] md:grid-cols-2">
        <Field label={tx("customer", "Customer")}>
          <Select name="customerId" required>
            <option value="">{tx("select", "Select")}</option>
            {customers.data?.map((c) => <option key={c.id} value={c.id}>{c.legal_name}</option>)}
          </Select>
        </Field>
        <Field label={tx("documentRoute", "Document route")}>
          <Select name="documentRoute" defaultValue="DIRECT_ROUTE">
            <option value="DIRECT_ROUTE">{tx("directCourier", "Direct courier")}</option>
            <option value="BANK_ROUTE">{tx("bankRoute", "Bank route")}</option>
          </Select>
        </Field>
        <Field label={tx("destinationCountry", "Destination country")}><Input name="destinationCountry" dir="ltr" /></Field>
        <Field label={tx("documentTemplate", "Document template")}>
          <Select name="templateId">
            <option value="">{tx("defaultTemplate", "Default")}</option>
            {templates.data?.map((t) => <option key={String(t.id)} value={String(t.id)}>{String(t.name_en)}</option>)}
          </Select>
        </Field>
      </section>
      <section className="grid gap-3 rounded-2xl border border-line bg-card p-4 shadow-[var(--shadow-card)] md:grid-cols-2">
        <h2 className="md:col-span-2 font-medium">{tx("commercialInvoice", "Commercial invoice (optional at draft)")}</h2>
        <Field label={tx("invoiceNumber", "Invoice number")}><Input name="invoiceNumber" dir="ltr" /></Field>
        <Field label={tx("invoiceDate", "Invoice date")}><Input name="invoiceDate" type="date" dir="ltr" /></Field>
        <Field label={tx("incoterm", "Incoterm")}>
          <Select name="incoterm" defaultValue="FOB">
            <option>FOB</option>
            <option>CFR</option>
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
        <Field label={tx("currency", "Currency")}><Input name="currency" defaultValue="USD" dir="ltr" /></Field>
        <Field label={tx("goodsValue", "Goods value")}><Input name="goodsValue" placeholder="0.00" dir="ltr" inputMode="decimal" /></Field>
        <Field label={tx("invoicedFreight", "Invoiced freight (CFR only)")}><Input name="invoicedFreight" placeholder="0.00" dir="ltr" inputMode="decimal" /></Field>
        <Field label={tx("actualFreight", "Actual freight expense")}><Input name="actualFreightExpense" placeholder="0.00" dir="ltr" inputMode="decimal" /></Field>
        <Field label={tx("invoiceTotal", "Invoice total")}><Input name="invoiceTotal" placeholder="0.00" dir="ltr" inputMode="decimal" /></Field>
        <p className="md:col-span-2 text-xs text-ink-muted">{tx("invoiceTotalHint", "Entered total. Not calculated.")}</p>
        <Field label={tx("portOfLoading", "Port of loading")}><Input name="portOfLoading" /></Field>
        <Field label={tx("portOfDischarge", "Port of discharge")}><Input name="portOfDischarge" /></Field>
        <Field label={tx("grossWeight", "Gross weight (kg)")}><Input name="grossWeight" type="number" step="0.001" dir="ltr" /></Field>
        <Field label={tx("netWeight", "Net weight (kg)")}><Input name="netWeight" type="number" step="0.001" dir="ltr" /></Field>
      </section>
      {mutation.isError ? <AlertText>{fail(mutation.error)}</AlertText> : null}
      <Button type="submit" disabled={mutation.isPending}>{tx("createDraft", "Create draft case")}</Button>
    </form>
  );
}

type CaseOverview = {
  case: Record<string, string | number | null>;
  customer: Record<string, string>;
  snapshot: Record<string, string>;
  invoices: Array<Record<string, string | number>>;
  requirements: Array<Record<string, string | number>>;
  bookings: Array<Record<string, string | number>>;
  containers: Array<Record<string, string | number>>;
  reminders: Array<Record<string, string>>;
  documentVersions?: Array<Record<string, string | number>>;
};

export function CaseDetailPage() {
  const { tx, stored, fail } = useCopy();
  const { id } = useParams();
  const client = useQueryClient();
  const [tab, setTab] = useState("overview");
  const [caseError, setCaseError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["case", id],
    queryFn: async () => (await api<CaseOverview>(`/api/v1/export-cases/${id}`)).data,
  });
  if (query.isLoading) return <p>{tx("loadingCase", "Loading case…")}</p>;
  if (!query.data) return <p className="text-danger">{tx("caseDenied", "Case not found or not permitted.")}</p>;
  const data = query.data;
  const tabs = ["overview", "invoices", "documents", "bank", "courier", "bookings", "reminders", "share"];
  return (
    <div className="space-y-5" data-dossier="loaded">
      <header className="rounded-2xl border border-line bg-card p-4 shadow-[var(--shadow-card)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-ink"><Ltr>{String(data.case.case_reference)}</Ltr></h1>
          <p className="mt-1 text-sm text-ink">{data.customer?.legal_name}</p>
          <p className="mt-1 max-w-3xl text-sm text-ink-muted">{data.snapshot?.legal_name} {tx("snapshotOf", "snapshot")} · {tx("liveProfile", "live profile is")} {data.customer?.legal_name}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge value={String(data.case.status)} />
          {data.case.status === "DRAFT" ? (
            <Button size="sm" variant="outline" onClick={async () => {
              try {
                await api(`/api/v1/export-cases/${id}/status`, { method: "POST", body: JSON.stringify({ to: "ACTIVE", version: data.case.version }) });
                setCaseError(null);
                await client.invalidateQueries({ queryKey: ["case", id] });
              } catch (error) {
                setCaseError(fail(error));
              }
            }}>{tx("markActive", "Mark active")}</Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={async () => {
            try {
              await api(`/api/v1/export-cases/${id}/status`, { method: "POST", body: JSON.stringify({ to: "COMPLETED", version: data.case.version }) });
              await client.invalidateQueries({ queryKey: ["case", id] });
            } catch (error) {
              setCaseError(fail(error));
            }
          }}>{tx("completeCase", "Complete case")}</Button>
        </div>
        </div>
        <div className="mt-4 rounded-xl bg-paper px-3 py-3">
          <h2 className="text-sm font-semibold text-ink">{tx("nextAction", "Next action")}</h2>
          <p className="mt-1 text-sm text-ink">{stored(String(data.case.next_action || "Review checklist"))}</p>
        </div>
      </header>
      {caseError ? <AlertText>{caseError}</AlertText> : null}
      <DualLane
        documentTitle={tx("documentTrack", "Document track")}
        documentStatus={String(data.case.document_route === "BANK_ROUTE" ? data.case.bank_path_status : data.case.direct_path_status)}
        documentHint={<>{tx("routeLabel", "Route")}: {tx(`status.${String(data.case.document_route)}`, String(data.case.document_route))}</>}
        documentSteps={
          data.case.document_route === "BANK_ROUTE"
            ? [
                { key: "PREPARING", label: tx("status.PREPARING", "Preparing") },
                { key: "SCANNED", label: tx("status.SCANNED", "Scanned") },
                { key: "HANDED_TO_BANK", label: tx("status.HANDED_TO_BANK", "Handed to bank") },
                { key: "BANK_REVIEW", label: tx("status.BANK_REVIEW", "Bank review") },
                { key: "BANK_APPROVED", label: tx("status.BANK_APPROVED", "Approved by bank") },
              ]
            : [
                { key: "NOT_STARTED", label: tx("status.NOT_STARTED", "Not started") },
                { key: "SCANNED", label: tx("status.SCANNED", "Scanned") },
                { key: "READY_FOR_DISPATCH", label: tx("status.READY_FOR_DISPATCH", "Ready") },
                { key: "DISPATCHED", label: tx("status.DISPATCHED", "Dispatched") },
                { key: "DOCUMENTS_DELIVERED", label: tx("status.DOCUMENTS_DELIVERED", "Documents delivered") },
              ]
        }
        documentCurrent={String(data.case.document_route === "BANK_ROUTE" ? data.case.bank_path_status : data.case.direct_path_status)}
        goodsTitle={tx("goodsTrack", "Goods track")}
        goodsStatus={data.containers.some((c) => c.status === "DELIVERED_TO_CUSTOMER") ? "DELIVERED_TO_CUSTOMER" : String(data.containers[0]?.status || "PLANNED")}
        goodsHint={`${data.containers.length} ${tx("slotsNote", "container slots. Port arrival is not customer delivery.")}`}
        goodsSteps={[
          { key: "PLANNED", label: tx("status.PLANNED", "Planned") },
          { key: "LOADED", label: tx("status.LOADED", "Loaded") },
          { key: "DEPARTED", label: tx("status.DEPARTED", "Departed") },
          { key: "ARRIVED_PORT", label: tx("status.ARRIVED_PORT", "Arrived port") },
          { key: "DELIVERED_TO_CUSTOMER", label: tx("status.DELIVERED_TO_CUSTOMER", "Delivered to customer") },
        ]}
        goodsCurrent={
          data.containers.some((c) => c.status === "DELIVERED_TO_CUSTOMER")
            ? "DELIVERED_TO_CUSTOMER"
            : data.containers.some((c) => c.status === "ARRIVED_PORT")
              ? "ARRIVED_PORT"
              : data.containers.some((c) => c.status === "DEPARTED")
                ? "DEPARTED"
                : data.containers.some((c) => c.status === "LOADED")
                  ? "LOADED"
                  : "PLANNED"
        }
      />
      {data.containers.length ? (
        <section className="rounded-2xl border border-line bg-card p-4 shadow-[var(--shadow-card)]">
          <h2 className="text-sm font-semibold text-ink">{tx("containerSlots", "Container slots")}</h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {data.containers.map((slot) => {
              const number = String(slot.official_number ?? "").trim();
              return (
                <li key={String(slot.id)} className="rounded-xl border border-line bg-paper px-3 py-2 text-sm">
                  <p className="text-ink-muted">{tx("slotIndex", "Slot")} <Ltr>{String(slot.slot_index)}</Ltr></p>
                  <p className="mt-1 font-medium text-ink">{number ? <Ltr>{number}</Ltr> : tx("isoUnknown", "No official container number yet")}</p>
                  <div className="mt-2"><StatusBadge value={String(slot.status)} /></div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      <nav className="flex flex-wrap gap-2" aria-label={tx("caseSections", "Case sections")}>
        {tabs.map((item) => (
          <Button key={item} data-tab={item} size="sm" variant={tab === item ? "default" : "outline"} onClick={() => setTab(item)} aria-current={tab === item ? "page" : undefined}>
            {tx(`tabs.${item}`, item)}
          </Button>
        ))}
      </nav>
      {tab === "overview" ? (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-line bg-card p-4 text-sm">
            {tx("nextAction", "Next action")}: {stored(String(data.case.next_action || "Review checklist"))}
          </div>
          <div className="rounded-xl border border-line bg-card p-4 text-sm">
            {tx("openRemindersCount", "Open reminders")}: {data.reminders.length}
          </div>
          <div className="md:col-span-2">
            <CustomFieldsPanel endpoint={`/api/v1/export-cases/${id}/custom-fields`} draft={data.case.status === "DRAFT" || data.case.status === "CANCELLED"} />
          </div>
        </div>
      ) : null}
      {tab === "invoices" ? <InvoicePanel invoices={data.invoices} caseStatus={String(data.case.status)} /> : null}
      {tab === "documents" ? <DocumentsPanel caseId={String(id)} requirements={data.requirements} versions={(data.documentVersions ?? []) as Array<Record<string, string | number>>} onDone={() => client.invalidateQueries({ queryKey: ["case", id] })} /> : null}
      {tab === "bank" ? <BankPanel caseId={String(id)} route={String(data.case.document_route)} status={String(data.case.bank_path_status)} onDone={() => client.invalidateQueries({ queryKey: ["case", id] })} /> : null}
      {tab === "courier" ? <CourierPanel caseId={String(id)} /> : null}
      {tab === "bookings" ? <BookingPanel caseId={String(id)} bookings={data.bookings} /> : null}
      {tab === "reminders" ? (
        <ul className="space-y-2 rounded-xl border border-line bg-card p-4 text-sm">
          {data.reminders.map((r) => <li key={r.id}>{stored(r.reason)} · {tx("due", "due")} <Ltr>{formatWhen(r.due_at)}</Ltr> · <StatusBadge value={r.status} /></li>)}
          {!data.reminders.length ? <li>{tx("noOpenRemindersCase", "No open reminders.")}</li> : null}
        </ul>
      ) : null}
      {tab === "share" ? <SharePanel caseId={String(id)} /> : null}
    </div>
  );
}

function InvoicePanel({ invoices, caseStatus }: { invoices: Array<Record<string, string | number>>; caseStatus: string }) {
  const { tx, fail } = useCopy();
  const user = useSession();
  const locked = caseStatus === "COMPLETED";
  const canCorrect = can(user, "invoices.correct_completed");
  return (
    <div className="space-y-3">
      {locked ? <p className="rounded-xl border border-line bg-paper p-3 text-sm font-medium text-ink" role="status">{tx("invoiceLockedTitle", "Invoice locked")} — {tx("invoiceLocked", "This invoice is locked because the export operation is completed.")}</p> : null}
      {invoices.map((inv) => (
        <div key={String(inv.id)} className="rounded-xl border border-line bg-card p-4 text-sm">
          <div className="font-medium">{String(inv.invoice_number)} · {String(inv.incoterm)} {String(inv.incoterms_edition)}</div>
          <p><Ltr>{tx("goodsLabel", "Goods")} {formatMoney(inv.goods_value_minor, Number(inv.currency_decimals), String(inv.currency))}</Ltr> · <Ltr>{tx("invoicedFreightLabel", "Invoiced freight")} {formatMoney(inv.invoiced_freight_minor, Number(inv.currency_decimals), String(inv.currency))}</Ltr></p>
          <p><Ltr>{tx("actualFreightLabel", "Actual freight expense")} {formatMoney(inv.actual_freight_expense_minor, Number(inv.currency_decimals), String(inv.currency))}</Ltr> · <Ltr>{tx("invoiceTotalLabel", "Invoice total")} {formatMoney(inv.invoice_total_minor, Number(inv.currency_decimals), String(inv.currency))}</Ltr></p>
          <p><Ltr>{tx("grossLabel", "Gross")} {gramsLabel(Number(inv.gross_weight_grams))}</Ltr> · <Ltr>{tx("netLabel", "Net")} {gramsLabel(Number(inv.net_weight_grams))}</Ltr></p>
          {locked ? <RevisionList invoiceId={String(inv.id)} /> : null}
          {locked && canCorrect ? (
            <form
              className="mt-3 grid gap-2"
              onSubmit={async (event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                const decimals = Number(inv.currency_decimals);
                const money = (name: string, minor: string | number) => String(form.get(name) || minorToDecimalString(minor, decimals));
                try {
                  await api(`/api/v1/invoices/${String(inv.id)}/corrections`, {
                    method: "POST",
                    body: JSON.stringify({
                      version: inv.version,
                      reason: form.get("reason"),
                      invoiceNumber: inv.invoice_number,
                      invoiceDate: inv.invoice_date,
                      paymentTermCode: inv.payment_term_code,
                      incoterm: inv.incoterm,
                      currency: inv.currency,
                      goodsValue: money("goodsValue", inv.goods_value_minor),
                      invoicedFreight: money("invoicedFreight", inv.invoiced_freight_minor),
                      actualFreightExpense: money("actualFreightExpense", inv.actual_freight_expense_minor),
                      invoiceTotal: money("invoiceTotal", inv.invoice_total_minor),
                      grossWeight: Number(inv.gross_weight_grams) / 1000,
                      netWeight: Number(inv.net_weight_grams) / 1000,
                      weightUnit: "KG",
                      portOfLoading: inv.port_of_loading || undefined,
                      portOfDischarge: inv.port_of_discharge || undefined,
                      notes: form.get("notes") || inv.notes,
                    }),
                  });
                  window.location.reload();
                } catch (error) {
                  event.currentTarget.querySelector("[data-correction-error]")?.replaceChildren(fail(error));
                }
              }}
            >
              <p className="text-ink-muted">{tx("correctionIntro", "Enter the invoice total yourself. Goods and freight stay separate and are not added together.")}</p>
              <Field label={tx("goodsLabel", "Goods")}>
                <Input name="goodsValue" dir="ltr" defaultValue={minorToDecimalString(inv.goods_value_minor, Number(inv.currency_decimals))} />
              </Field>
              <Field label={tx("invoicedFreightLabel", "Invoiced freight")}>
                <Input name="invoicedFreight" dir="ltr" defaultValue={minorToDecimalString(inv.invoiced_freight_minor, Number(inv.currency_decimals))} />
              </Field>
              <Field label={tx("actualFreightLabel", "Actual freight expense")}>
                <Input name="actualFreightExpense" dir="ltr" defaultValue={minorToDecimalString(inv.actual_freight_expense_minor, Number(inv.currency_decimals))} />
              </Field>
              <Field label={tx("invoiceTotalLabel", "Invoice total")}>
                <Input name="invoiceTotal" dir="ltr" defaultValue={minorToDecimalString(inv.invoice_total_minor, Number(inv.currency_decimals))} />
              </Field>
              <Field label={tx("correctionReason", "Correction reason")}>
                <Input name="reason" required minLength={3} />
              </Field>
              <Field label={tx("notes", "Notes")}>
                <Input name="notes" defaultValue={String(inv.notes ?? "")} />
              </Field>
              <p data-correction-error role="alert" className="text-danger" />
              <Button type="submit" size="sm">{tx("exceptionalCorrection", "Exceptional correction")}</Button>
            </form>
          ) : null}
          <div className="mt-3">
            <CustomFieldsPanel endpoint={`/api/v1/invoices/${String(inv.id)}/custom-fields`} locked={locked} />
          </div>
        </div>
      ))}
      {!invoices.length ? <p className="text-ink-muted">{tx("noInvoices", "No invoices on this case yet.")}</p> : null}
    </div>
  );
}

function RevisionList({ invoiceId }: { invoiceId: string }) {
  const { tx } = useCopy();
  const query = useQuery({
    queryKey: ["revisions", invoiceId],
    retry: false,
    queryFn: async () => (await api<Array<Record<string, string>>>(`/api/v1/invoices/${invoiceId}/revisions`)).data,
  });
  if (query.isLoading) return <p className="mt-3 text-ink-muted">{tx("loadingData", "Loading…")}</p>;
  if (query.isError) return <p className="mt-3 text-ink-muted">{tx("revisionsUnavailable", "Revision history is not available on this database yet.")}</p>;
  if (!query.data?.length) return <p className="mt-3 text-ink-muted">{tx("noRevisions", "No corrections have been recorded.")}</p>;
  return (
    <ul className="mt-3 space-y-2">
      <li className="font-medium">{tx("revisionsTitle", "Correction history")}</li>
      {query.data.map((row) => {
        let afterTotal = "";
        try {
          const parsed = JSON.parse(row.after_json) as { invoice?: { invoice_total_minor?: number; currency?: string; currency_decimals?: number } };
          const invoice = parsed.invoice;
          if (invoice?.invoice_total_minor != null) {
            afterTotal = formatMoney(invoice.invoice_total_minor, Number(invoice.currency_decimals ?? 2), String(invoice.currency ?? "USD"));
          }
        } catch {
          afterTotal = "";
        }
        return (
        <li key={row.id} className="rounded-lg border border-line p-2">
          <p>{row.reason}</p>
          {afterTotal ? <p><Ltr>{tx("invoiceTotalLabel", "Invoice total")} {afterTotal}</Ltr></p> : null}
          <p className="text-ink-muted"><Ltr>{row.created_at}</Ltr></p>
        </li>
        );
      })}
    </ul>
  );
}

function formatBytes(value: number | string, language: string) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  const units = language.startsWith("ar")
    ? ["بايت", "ك.ب", "م.ب", "ج.ب"]
    : ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const size = bytes / 1024 ** index;
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function DocumentsPanel({
  caseId,
  requirements,
  versions,
  onDone,
}: {
  caseId: string;
  requirements: Array<Record<string, string | number>>;
  versions: Array<Record<string, string | number>>;
  onDone: () => void;
}) {
  const { tx, fail, ar, i18n } = useCopy();
  const [typeError, setTypeError] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const types = useQuery({
    queryKey: ["doctypes"],
    queryFn: async () => (await api<Array<Record<string, string>>>("/api/v1/document-types")).data,
  });
  return (
    <div className="space-y-3">
      {uploadError ? <AlertText>{uploadError}</AlertText> : null}
      {requirements.map((req) => {
        const reqId = String(req.id);
        const uploading = progress[reqId] != null;
        const rows = versions.filter((v) => String(v.requirement_id) === reqId);
        return (
        <div key={reqId} className="rounded-xl border border-line bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-medium">{(ar && String(req.name_ar || "").trim()) ? String(req.name_ar) : String(req.name_en)} {Number(req.required) ? `(${tx("required", "required")})` : `(${tx("optional", "optional")})`}</div>
              <StatusBadge value={String(req.status)} />
            </div>
            <label className={`inline-flex cursor-pointer items-center gap-2 rounded-md border border-line px-3 py-1.5 text-sm font-medium ${uploading ? "bg-paper text-ink-muted" : "bg-paper"}`}>
              {uploading ? (
                <>
                  <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-line border-t-accent" aria-hidden="true" />
                  {tx("uploading", "Uploading…")} {progress[reqId]}%
                </>
              ) : (
                tx("chooseFile", "Choose file")
              )}
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                className="sr-only"
                disabled={uploading}
                onChange={async (event) => {
                  const input = event.currentTarget;
                  const file = input.files?.[0];
                  if (!file) return;
                  setUploadError(null);
                  setProgress((current) => ({ ...current, [reqId]: 0 }));
                  try {
                    const uploaded = await uploadFile(file, "document_requirement", reqId, (pct) =>
                      setProgress((current) => ({ ...current, [reqId]: pct })),
                    );
                    await api(`/api/v1/document-requirements/${reqId}/versions`, {
                      method: "POST",
                      body: JSON.stringify({
                        r2Key: uploaded.objectKey,
                        originalName: uploaded.filename,
                        contentType: uploaded.mime,
                        byteSize: uploaded.byteSize,
                      }),
                    });
                    notifySuccess(tx("documentUploaded", "File uploaded"), file.name);
                    onDone();
                  } catch (error) {
                    setUploadError(fail(error));
                    notifyError(error);
                  } finally {
                    setProgress((current) => {
                      const next = { ...current };
                      delete next[reqId];
                      return next;
                    });
                    input.value = "";
                  }
                }}
              />
            </label>
          </div>
          {uploading ? (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={progress[reqId]} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progress[reqId]}%` }} />
            </div>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-2">
            {["UNDER_REVIEW", "APPROVED", "NEEDS_CORRECTION", "WAIVED"].map((decision) => (
              <Button
                key={decision}
                data-decision={decision}
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    await api(`/api/v1/document-requirements/${reqId}/review`, {
                      method: "POST",
                      body: JSON.stringify({ decision, reason: decision === "WAIVED" ? "Authorized waiver" : undefined }),
                    });
                    notifySuccess(tx("reviewUpdated", "Review status updated"));
                    onDone();
                  } catch (error) {
                    notifyError(error);
                  }
                }}
              >
                {tx(`status.${decision}`, decision)}
              </Button>
            ))}
          </div>
          {rows.length ? (
            <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-paper/40 text-sm">
              {rows.map((version) => (
                <li key={String(version.id)} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{String(version.original_name)}</p>
                    <p className="text-xs text-ink-muted">
                      {tx("version", "Version")} <Ltr>{String(version.version)}</Ltr>
                      {" · "}<Ltr>{formatBytes(version.byte_size, i18n.language)}</Ltr>
                      {" · "}<Ltr>{formatWhen(String(version.created_at))}</Ltr>
                      {" · "}<StatusBadge value={String(version.review_state)} />
                    </p>
                  </div>
                  <a
                    className="shrink-0 rounded-md border border-line bg-card px-2.5 py-1 text-xs font-medium underline-offset-2 hover:underline"
                    href={`/api/v1/files/download?key=${encodeURIComponent(String(version.r2_key))}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {tx("openFile", "Open file")}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-xs text-ink-muted">{tx("noFileYet", "No file uploaded for this requirement yet.")}</p>
          )}
        </div>
        );
      })}
      <form
        className="grid gap-2 rounded-xl border border-dashed border-line bg-card p-4 md:grid-cols-[1fr_8rem_auto]"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          const typeId = String(data.get("documentTypeId") ?? "").trim();
          setAddError(null);
          if (!typeId) {
            setTypeError(tx("errors.DOCUMENT_TYPE_REQUIRED", "Choose a document type before adding it."));
            form.querySelector<HTMLSelectElement>("select[name=documentTypeId]")?.focus();
            return;
          }
          setTypeError(null);
          try {
            await api(`/api/v1/export-cases/${caseId}/document-requirements`, {
              method: "POST",
              body: JSON.stringify({ documentTypeId: typeId, required: data.get("required") === "1" }),
            });
            notifySuccess(tx("requirementAdded", "Document added to this case"));
            form.reset();
            onDone();
          } catch (error) {
            const fields = fieldErrorsOf(error);
            setTypeError(fields.documentTypeId ? tx("errors.DOCUMENT_TYPE_REQUIRED", fields.documentTypeId) : null);
            setAddError(fail(error));
            notifyError(error);
          }
        }}
      >
        <Field label={tx("documentTemplate", "Document template")} error={typeError ?? undefined} errorId="documentTypeId-error">
          <Select
            name="documentTypeId"
            aria-invalid={Boolean(typeError)}
            aria-describedby={typeError ? "documentTypeId-error" : undefined}
            onChange={() => setTypeError(null)}
          >
            <option value="">{tx("select", "Select")}</option>
            {types.data?.map((t) => <option key={t.id} value={t.id}>{(ar && t.name_ar?.trim()) ? t.name_ar : t.name_en}</option>)}
          </Select>
        </Field>
        <Field label={tx("required", "Required")}>
          <Select name="required" defaultValue="1">
            <option value="1">{tx("required", "Required")}</option>
            <option value="0">{tx("optional", "Optional")}</option>
          </Select>
        </Field>
        <div className="flex items-end">
          <Button size="sm" type="submit">{tx("addToCase", "Add to this case")}</Button>
        </div>
        {addError ? <div className="md:col-span-3"><AlertText>{addError}</AlertText></div> : null}
      </form>
    </div>
  );
}

function BankPanel({ caseId, route, status, onDone }: { caseId: string; route: string; status: string; onDone: () => void }) {
  const { tx } = useCopy();
  if (route !== "BANK_ROUTE") {
    return (
      <div className="rounded-xl border border-line bg-card p-4">
        <p>{tx("directRouteCopy", "This case uses the direct route. Bank stages are not required and must not block dispatch.")}</p>
        <DirectButtons caseId={caseId} onDone={onDone} />
      </div>
    );
  }
  const steps = ["PREPARING", "SCANNED", "READY_FOR_PHYSICAL_HANDOVER", "HANDED_TO_BANK", "BANK_REVIEW", "CORRECTION_REQUESTED", "BANK_APPROVED"];
  return (
    <div className="rounded-xl border border-line bg-card p-4">
      <p className="mb-3">{tx("currentBankPath", "Current bank path")}: <StatusBadge value={status} /></p>
      <div className="flex flex-wrap gap-2">
        {steps.map((to) => (
          <Button key={to} data-decision={to} size="sm" variant="outline" onClick={async () => {
            try {
              await api(`/api/v1/export-cases/${caseId}/bank/status`, { method: "POST", body: JSON.stringify({ to }) });
              notifySuccess(tx("bankStageSaved", "Bank stage saved"));
              onDone();
            } catch (error) {
              notifyError(error);
            }
          }}>{tx(`status.${to}`, to)}</Button>
        ))}
      </div>
    </div>
  );
}

function DirectButtons({ caseId, onDone }: { caseId: string; onDone: () => void }) {
  const { tx } = useCopy();
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {["SCANNED", "INTERNAL_REVIEW", "READY_FOR_DISPATCH"].map((to) => (
        <Button key={to} data-decision={to} size="sm" variant="outline" onClick={async () => {
          try {
            await api(`/api/v1/export-cases/${caseId}/direct/status`, { method: "POST", body: JSON.stringify({ to }) });
            notifySuccess(tx("directStageSaved", "Direct route stage saved"));
            onDone();
          } catch (error) {
            notifyError(error);
          }
        }}>{tx(`status.${to}`, to)}</Button>
      ))}
    </div>
  );
}

function CourierPanel({ caseId }: { caseId: string }) {
  const { tx } = useCopy();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["courier", caseId],
    queryFn: async () => (await api<Array<Record<string, unknown>>>(`/api/v1/export-cases/${caseId}/courier`)).data,
  });
  return (
    <div className="space-y-3">
      <form
        className="grid gap-2 rounded-xl border border-line bg-card p-4 md:grid-cols-2"
        onSubmit={async (event) => {
          event.preventDefault();
          const formEl = event.currentTarget;
          const form = new FormData(formEl);
          try {
            await api(`/api/v1/export-cases/${caseId}/courier`, {
              method: "POST",
              body: JSON.stringify({
                sender: form.get("sender"),
                carrier: form.get("carrier"),
                trackingNumber: form.get("trackingNumber"),
                recipientSummary: form.get("recipientSummary"),
              }),
            });
            formEl.reset();
            notifySuccess(tx("courierShipmentAdded", "Manual shipment added"));
            await client.invalidateQueries({ queryKey: ["courier", caseId] });
          } catch (error) {
            notifyError(error);
          }
        }}
      >
        <Field label={tx("sender", "Sender")}>
          <Select name="sender" defaultValue="COMPANY"><option>COMPANY</option><option>BANK</option></Select>
        </Field>
        <Field label={tx("carrier", "Carrier")}>
          <Select name="carrier" defaultValue="DHL"><option>DHL</option><option>UPS</option><option>FEDEX</option><option>ARAMEX</option><option>TNT</option></Select>
        </Field>
        <Field label={tx("trackingNumber", "Tracking number")}><Input name="trackingNumber" dir="ltr" /></Field>
        <Field label={tx("recipientSummary", "Recipient summary")}><Input name="recipientSummary" /></Field>
        <Button type="submit">{tx("addManualShipment", "Add manual shipment")}</Button>
      </form>
      {query.data?.map((s) => (
        <div key={String(s.id)} className="rounded-xl border border-line bg-card p-4 text-sm">
          <div>{String(s.carrier)} · <Ltr>{String(s.tracking_number || tx("noNumber", "no number"))}</Ltr> · <StatusBadge value={String(s.status)} /></div>
          <p className="text-ink-muted">{tx("sourceManual", "Source: MANUAL")}. {s.trackingUrl ? <a className="underline" href={String(s.trackingUrl)} target="_blank" rel="noreferrer">{tx("openCarrier", "Open carrier page")}</a> : tx("noTrackingUrl", "No allowlisted tracking URL.")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {["DISPATCHED", "IN_TRANSIT", "DELIVERED"].map((status) => (
              <Button key={status} size="sm" variant="outline" onClick={async () => {
                try {
                  await api(`/api/v1/courier/${s.id}/status`, { method: "POST", body: JSON.stringify({ status, version: s.version }) });
                  notifySuccess(tx("courierStatusSaved", "Shipment status updated"));
                  await client.invalidateQueries({ queryKey: ["courier", caseId] });
                } catch (error) {
                  notifyError(error);
                }
              }} data-decision={status}>{tx(`status.${status}`, status)}</Button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function BookingPanel({ caseId, bookings }: { caseId: string; bookings: Array<Record<string, string | number>> }) {
  const { tx } = useCopy();
  return (
    <div className="space-y-3">
      <form
        className="grid gap-2 rounded-xl border border-line bg-card p-4 md:grid-cols-2"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          try {
            const created = await api<{ id: string }>("/api/v1/bookings", {
              method: "POST",
              body: JSON.stringify({
                caseId,
                bookingNumber: form.get("bookingNumber"),
                ucr: form.get("ucr") || undefined,
                shippingLine: form.get("shippingLine"),
                expectedContainers: Number(form.get("expectedContainers") || 0),
                plannedLoadingDate: form.get("plannedLoadingDate") || undefined,
                cutoffDate: form.get("cutoffDate") || undefined,
                plannedEtd: form.get("plannedEtd") || undefined,
                plannedEta: form.get("plannedEta") || undefined,
              }),
            });
            notifySuccess(tx("bookingCreated", "Booking created"));
            window.location.href = `/bookings/${created.data.id}`;
          } catch (error) {
            notifyError(error);
          }
        }}
      >
        <Field label={tx("bookingNumber", "Booking number")}><Input name="bookingNumber" required dir="ltr" /></Field>
        <Field label={tx("ucr", "UCR (optional)")}><Input name="ucr" dir="ltr" /></Field>
        <Field label={tx("shippingLine", "Shipping line")}><Input name="shippingLine" /></Field>
        <Field label={tx("expectedContainers", "Expected containers")}><Input name="expectedContainers" type="number" min={0} defaultValue={0} dir="ltr" /></Field>
        <Field label={tx("plannedLoading", "Planned loading")}><Input name="plannedLoadingDate" type="date" dir="ltr" /></Field>
        <Field label={tx("cutoff", "Cutoff")}><Input name="cutoffDate" type="date" dir="ltr" /></Field>
        <Field label={tx("plannedEtd", "Planned ETD")}><Input name="plannedEtd" type="date" dir="ltr" /></Field>
        <Field label={tx("plannedEta", "Planned ETA")}><Input name="plannedEta" type="date" dir="ltr" /></Field>
        <Button type="submit">{tx("createBooking", "Create booking")}</Button>
      </form>
      {bookings.map((b) => (
        <Link key={String(b.id)} className="block rounded-xl border border-line bg-card p-4" to={`/bookings/${b.id}`}>
          {String(b.booking_number)} · {String(b.status)} · expected {String(b.expected_containers)}
        </Link>
      ))}
    </div>
  );
}

function SharePanel({ caseId }: { caseId: string }) {
  const { tx } = useCopy();
  const [token, setToken] = useState<string | null>(null);
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["links", caseId],
    queryFn: async () => (await api<Array<Record<string, string>>>(`/api/v1/export-cases/${caseId}/tracking-links`)).data,
  });
  return (
    <div className="space-y-3 rounded-xl border border-line bg-card p-4">
      <p className="text-sm">{tx("shareHint", "The token is shown once. Revoked or rotated links fail immediately. Bank details and files are never included.")}</p>
      <Button onClick={async () => {
        try {
          const res = await api<{ token: string }>(`/api/v1/export-cases/${caseId}/tracking-links`, { method: "POST", body: JSON.stringify({}) });
          setToken(res.data.token);
          notifySuccess(tx("trackingCreated", "Tracking link created"));
          await client.invalidateQueries({ queryKey: ["links", caseId] });
        } catch (error) {
          notifyError(error);
        }
      }}>{tx("createTrackingLink", "Create tracking link")}</Button>
      {token ? <p className="break-all rounded bg-paper p-2 text-sm">{`${window.location.origin}/track/${token}`}</p> : null}
      {query.data?.map((l) => (
        <div key={l.id} className="flex items-center justify-between text-sm">
          <span>{l.revoked_at ? tx("revoked", "revoked") : tx("active", "active")} · {tx("expires", "expires")} <Ltr>{l.expires_at || tx("none", "none")}</Ltr></span>
          <Button size="sm" variant="outline" onClick={async () => {
            try {
              await api(`/api/v1/tracking-links/${l.id}/revoke`, { method: "POST" });
              notifySuccess(tx("trackingRevoked", "Tracking link revoked"));
              await client.invalidateQueries({ queryKey: ["links", caseId] });
            } catch (error) {
              notifyError(error);
            }
          }}>{tx("revoke", "Revoke")}</Button>
        </div>
      ))}
    </div>
  );
}
