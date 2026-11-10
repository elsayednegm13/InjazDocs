import { Dialog, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogTitle } from "@radix-ui/react-dialog";
import { Bell, ClipboardList } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { AlertText, DualLane, EmptyState, Ltr, SectionCard } from "@/components/ui/chrome";
import { StatusBadge } from "@/components/ui/status";
import { CaseDetailSkeleton } from "@/components/ui/skeleton";
import { CustomFieldsPanel } from "@/features/fields/CustomFieldsPanel";
import { api } from "@/lib/api";
import { notifyError, notifySuccess } from "@/lib/notify";
import { useCopy } from "@/lib/copy";
import { customerAcceptancePending } from "@shared/customer-file-share";

import { DOCUMENT_STEP_OF, formatWhen } from "./case-format";
import { InvoicePanel } from "./InvoicePanel";
import { DocumentsPanel } from "./DocumentsPanel";
import { BankPanel, CourierPanel } from "./CaseRoutePanels";
import { BookingPanel } from "./BookingPanel";
import { SharePanel } from "./SharePanel";

type CaseOverview = {
  case: Record<string, string | number | null>;
  customer: Record<string, string>;
  snapshot: Record<string, string>;
  invoices: Array<Record<string, string | number>>;
  requirements: Array<Record<string, string | number>>;
  bookings: Array<Record<string, string | number>>;
  containers: Array<Record<string, string | number>>;
  reminders: Array<Record<string, string>>;
  documentVersions?: Array<Record<string, string | number | null>>;
  customerFileShareReady?: boolean;
};

export function CaseDetailPage() {
  const { tx, stored, fail } = useCopy();
  const { id } = useParams();
  const client = useQueryClient();
  const [tab, setTab] = useState("overview");
  const [caseError, setCaseError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [closing, setClosing] = useState(false);
  const query = useQuery({
    queryKey: ["case", id],
    refetchInterval: 15_000,
    refetchIntervalInBackground: true,
    queryFn: async () => (await api<CaseOverview>(`/api/v1/export-cases/${id}`)).data,
  });
  if (query.isLoading) return <CaseDetailSkeleton />;
  if (query.isError) return <p className="text-danger">{tx("casesError", "Could not load cases.")}</p>;
  if (!query.data) return <p className="text-danger">{tx("caseDenied", "Case not found or not permitted.")}</p>;
  const data = query.data;
  const versions = (data.documentVersions ?? []) as Array<Record<string, string | number | null>>;
  const customerAcceptanceOpen = data.customerFileShareReady === true && customerAcceptancePending(versions.map((row) => ({
    requirementId: String(row.requirement_id ?? ""),
    version: Number(row.version) || 0,
    published: Number(row.customer_published) === 1,
    decision: row.customer_decision == null ? null : String(row.customer_decision),
  })).filter((row) => row.requirementId));
  async function completeCase() {
    if (closing) return;
    setClosing(true);
    try {
      await api(`/api/v1/export-cases/${id}/status`, { method: "POST", body: JSON.stringify({ to: "COMPLETED", version: data.case.version }) });
      setConfirmClose(false);
      setCaseError(null);
      notifySuccess(tx("caseCompleted", "Case completed"));
      await client.invalidateQueries({ queryKey: ["case", id] });
      await client.invalidateQueries({ queryKey: ["notifications"] });
      await client.invalidateQueries({ queryKey: ["reminders"] });
    } catch (error) {
      setConfirmClose(false);
      setCaseError(fail(error));
      notifyError(error);
    } finally {
      setClosing(false);
    }
  }
  const tabs = ["overview", "invoices", "documents", "bank", "courier", "bookings", "reminders", "share"];
  return (
    <div className="space-y-4" data-dossier="loaded">
      <header className="overflow-hidden rounded-card border border-line bg-card shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-4 p-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">{tx("caseFile", "Case file")}</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink"><Ltr>{String(data.case.case_reference)}</Ltr></h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusBadge value={String(data.case.status)} />
              <span className="text-sm font-medium text-ink">{data.customer?.customer_code ? <Ltr className="me-1.5 text-accent">{String(data.customer.customer_code)}</Ltr> : null}{data.customer?.legal_name}</span>
            </div>
            <p className="mt-1 max-w-3xl text-xs text-ink-muted">{tx("snapshotOf", "snapshot")}: {data.snapshot?.legal_name} · {tx("liveProfile", "live profile is")} {data.customer?.legal_name}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {data.case.status === "DRAFT" ? (
              <Button size="sm" variant="outline" onClick={async () => {
                try {
                  await api(`/api/v1/export-cases/${id}/status`, { method: "POST", body: JSON.stringify({ to: "ACTIVE", version: data.case.version }) });
                  setCaseError(null);
                  notifySuccess(tx("caseMarkedActive", "Case marked active"));
                  await client.invalidateQueries({ queryKey: ["case", id] });
                } catch (error) {
                  setCaseError(fail(error));
                  notifyError(error);
                }
              }}>{tx("markActive", "Mark active")}</Button>
            ) : null}
            <Button size="sm" variant="outline" type="button" disabled={closing} onClick={() => {
              if (customerAcceptanceOpen) {
                setConfirmClose(true);
                return;
              }
              void completeCase();
            }}>{tx("completeCase", "Complete case")}</Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line bg-paper/60 px-4 py-3 text-xs text-ink-muted">
          <span>
            {tx("documentRoute", "Document route")}:{" "}
            <span className="font-semibold text-ink">{tx(`status.${String(data.case.document_route)}`, String(data.case.document_route))}</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            {tx("docs", "Docs")}:
            <StatusBadge value={String(data.case.document_route === "BANK_ROUTE" ? data.case.bank_path_status : data.case.direct_path_status)} />
          </span>
          <span>
            {tx("containers", "Containers")}: <span className="font-semibold text-ink tabular-nums"><Ltr>{data.containers.length}</Ltr></span>
          </span>
          <span>
            {tx("invoices", "Invoices")}: <span className="font-semibold text-ink tabular-nums"><Ltr>{data.invoices.length}</Ltr></span>
          </span>
        </div>
        <div className="flex items-start gap-2.5 border-t border-line px-4 py-3">
          <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent/10 text-accent" aria-hidden>
            <ClipboardList className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{tx("nextAction", "Next action")}</p>
            <p className="text-sm font-medium text-ink">{stored(String(data.case.next_action || "Review checklist"))}</p>
          </div>
        </div>
      </header>
      <Dialog open={confirmClose} onOpenChange={(open) => { if (!closing) setConfirmClose(open); }}>
        <DialogPortal>
          <DialogOverlay className="fixed inset-0 z-40 bg-ink/40" />
          <DialogContent className="fixed left-1/2 top-1/2 z-50 w-[min(100%-2rem,26rem)] -translate-x-1/2 -translate-y-1/2 rounded-card border border-line bg-card p-5 text-start shadow-card focus:outline-none">
            <DialogTitle className="text-base font-semibold text-ink">{tx("completeCase", "Complete case")}</DialogTitle>
            <DialogDescription className="mt-2 text-sm leading-relaxed text-ink-muted">
              {tx("completeWithoutCustomer", "The customer has not approved the documents yet. Are you sure you want to close the operation?")}
            </DialogDescription>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button type="button" size="sm" variant="outline" disabled={closing} onClick={() => setConfirmClose(false)}>
                {tx("keepCaseOpen", "Go back")}
              </Button>
              <Button type="button" size="sm" disabled={closing} onClick={() => void completeCase()}>
                {tx("confirmCaseClose", "Confirm close")}
              </Button>
            </div>
          </DialogContent>
        </DialogPortal>
      </Dialog>
      {caseError ? <AlertText>{caseError}</AlertText> : null}
      <DualLane
        documentTitle={tx("documentTrack", "Document track")}
        documentStatus={String(data.case.document_route === "BANK_ROUTE" ? data.case.bank_path_status : data.case.direct_path_status)}
        documentHint={<>{tx("routeLabel", "Route")}: {tx(`status.${String(data.case.document_route)}`, String(data.case.document_route))}</>}
        documentSteps={
          data.case.document_route === "BANK_ROUTE"
            ? [
                { key: "PREPARING", label: tx("status.PREPARING", "Preparing") },
                { key: "AT_BANK", label: tx("docAtBank", "At the bank") },
                { key: "APPROVED", label: tx("status.BANK_APPROVED", "Approved by bank") },
                { key: "DISPATCHED", label: tx("status.COURIER_DISPATCHED", "Dispatched") },
                { key: "DELIVERED", label: tx("status.DOCUMENTS_DELIVERED", "Documents delivered") },
              ]
            : [
                { key: "PREPARING", label: tx("status.PREPARING", "Preparing") },
                { key: "SCANNED", label: tx("status.SCANNED", "Scanned") },
                { key: "INTERNAL_REVIEW", label: tx("status.INTERNAL_REVIEW", "Internal review") },
                { key: "DISPATCHED", label: tx("status.COURIER_DISPATCHED", "Dispatched") },
                { key: "DELIVERED", label: tx("status.DOCUMENTS_DELIVERED", "Documents delivered") },
              ]
        }
        documentCurrent={
          (data.case.document_route === "BANK_ROUTE"
            ? DOCUMENT_STEP_OF.BANK_ROUTE
            : DOCUMENT_STEP_OF.DIRECT_ROUTE)[
            String(data.case.document_route === "BANK_ROUTE" ? data.case.bank_path_status : data.case.direct_path_status)
          ] ?? "PREPARING"
        }
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
        <section className="rounded-card border border-line bg-card p-4 shadow-card">
          <h2 className="text-sm font-semibold text-ink">{tx("containerSlots", "Container slots")}</h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {data.containers.map((slot) => {
              const number = String(slot.official_number ?? "").trim();
              return (
                <li key={String(slot.id)} className="rounded-control border border-line bg-paper px-3 py-2 text-sm">
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
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard title={tx("caseSummary", "Case summary")} icon={<ClipboardList className="h-4 w-4" />}>
              <dl className="space-y-2.5 text-sm">
                <div className="flex items-center justify-between gap-3 border-b border-line/60 pb-2.5">
                  <dt className="text-ink-muted">{tx("customer", "Customer")}</dt>
                  <dd className="min-w-0 truncate font-medium text-ink">{data.customer?.legal_name ?? "—"}</dd>
                </div>
                <div className="flex items-center justify-between gap-3 border-b border-line/60 pb-2.5">
                  <dt className="text-ink-muted">{tx("tradeName", "Trade name")}</dt>
                  <dd className="min-w-0 truncate font-medium text-ink">{data.customer?.trade_name || "—"}</dd>
                </div>
                <div className="flex items-center justify-between gap-3 border-b border-line/60 pb-2.5">
                  <dt className="text-ink-muted">{tx("country", "Country")}</dt>
                  <dd className="font-medium text-ink"><Ltr>{data.customer?.country_code || "—"}</Ltr></dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-ink-muted">{tx("documentRoute", "Document route")}</dt>
                  <dd className="font-medium text-ink">{tx(`status.${String(data.case.document_route)}`, String(data.case.document_route))}</dd>
                </div>
              </dl>
            </SectionCard>
            <SectionCard
              title={tx("openReminders", "Open reminders")}
              icon={<Bell className="h-4 w-4" />}
              action={
                <Button size="sm" variant="outline" onClick={() => setTab("reminders")}>
                  {tx("viewAll", "View all")}
                </Button>
              }
            >
              {data.reminders.length === 0 ? (
                <EmptyState>{tx("noOpenRemindersCase", "No open reminders.")}</EmptyState>
              ) : (
                <ul className="space-y-2">
                  {data.reminders.slice(0, 4).map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-line/70 bg-paper/40 px-3 py-2 text-sm">
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-ink">{stored(r.reason)}</span>
                        <span className="mt-0.5 block text-xs text-ink-muted">
                          {tx("due", "due")} <Ltr>{formatWhen(r.due_at)}</Ltr>
                        </span>
                      </span>
                      <StatusBadge value={r.status} />
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </div>
          <CustomFieldsPanel endpoint={`/api/v1/export-cases/${id}/custom-fields`} draft={data.case.status === "DRAFT" || data.case.status === "CANCELLED"} />
        </div>
      ) : null}
      {tab === "invoices" ? <InvoicePanel invoices={data.invoices} bookings={data.bookings} containers={data.containers} customerId={String(data.customer?.id ?? "")} customerName={String(data.customer?.legal_name ?? "")} customerCode={String(data.customer?.customer_code ?? "")} customerCountry={String(data.customer?.country_code ?? "")} caseId={String(id)} caseStatus={String(data.case.status)} onDone={() => client.invalidateQueries({ queryKey: ["case", id] })} /> : null}
      {tab === "documents" ? <DocumentsPanel caseId={String(id)} requirements={data.requirements} versions={(data.documentVersions ?? []) as Array<Record<string, string | number | null>>} customerShareReady={data.customerFileShareReady === true} onDone={() => client.invalidateQueries({ queryKey: ["case", id] })} /> : null}
      {tab === "bank" ? <BankPanel caseId={String(id)} route={String(data.case.document_route)} status={String(data.case.bank_path_status)} onDone={() => client.invalidateQueries({ queryKey: ["case", id] })} /> : null}
      {tab === "courier" ? <CourierPanel caseId={String(id)} /> : null}
      {tab === "bookings" ? <BookingPanel caseId={String(id)} bookings={data.bookings} /> : null}
      {tab === "reminders" ? (
        <SectionCard title={tx("reminders", "Reminders")} icon={<Bell className="h-4 w-4" />}>
          {data.reminders.length === 0 ? (
            <EmptyState>{tx("noOpenRemindersCase", "No open reminders.")}</EmptyState>
          ) : (
            <ul className="space-y-2">
              {data.reminders.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-line/70 bg-paper/40 px-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink">{stored(r.reason)}</span>
                    <span className="mt-0.5 block text-xs text-ink-muted">
                      {tx("due", "due")} <Ltr>{formatWhen(r.due_at)}</Ltr>
                    </span>
                  </span>
                  <StatusBadge value={r.status} />
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      ) : null}
      {tab === "share" ? (
        <SharePanel
          caseId={String(id)}
          customerName={String(data.customer?.legal_name ?? "")}
          customerCode={String(data.customer?.customer_code ?? "")}
          phone={String(data.customer?.phone ?? "")}
          country={String(data.customer?.country_code ?? "")}
          invoiceNumber={data.invoices.map((invoice) => String(invoice.invoice_number ?? "")).filter(Boolean).join("، ")}
        />
      ) : null}
    </div>
  );
}
