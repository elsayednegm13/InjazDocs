import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { Boxes, CalendarClock, ExternalLink, FileText, Ship, Truck } from "lucide-react";
import type { ReactNode } from "react";
import { useCompanyBrand } from "@/app/brand";
import { applyDir } from "@/app/i18n";
import { Button } from "@/components/ui/button";
import { DualLane, Ltr } from "@/components/ui/chrome";
import { StatusBadge } from "@/components/ui/status";
import { api } from "@/lib/api";
import { formatWhen, useCopy } from "@/lib/copy";
import { CustomerDocuments, type TrackDocument } from "@/features/track/CustomerFiles";
import { CustomerTimeline } from "@/features/track/CustomerTimeline";
import type { UnifiedTimelineEvent } from "@shared/customer-timeline";
import { CONTAINER_JOURNEY, containerJourneyIndex } from "@shared/container-flow";
import type { CustomerFileCard } from "@shared/customer-file-share";

function SlotRail({ status }: { status: string }) {
  const index = containerJourneyIndex(status);
  return (
    <div className="flex items-center gap-1" aria-hidden>
      {CONTAINER_JOURNEY.map((step, stepIndex) => (
        <span key={step} className={`h-1 flex-1 rounded-full ${stepIndex <= index ? "bg-accent" : "bg-line"}`} />
      ))}
    </div>
  );
}

function InfoRow({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-line/70 bg-paper/40 p-2">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-card text-accent ring-1 ring-line">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{label}</span>
        <span className="mt-0.5 block text-sm text-ink">{children}</span>
      </span>
    </div>
  );
}

export function TrackPage() {
  const { token } = useParams();
  const { tx, i18n } = useCopy();
  const ar = i18n.language.startsWith("ar");
  const productName = useCompanyBrand()?.name || "ExportFlow";
  const query = useQuery({
    queryKey: ["track", token],
    queryFn: async () => (await api<Record<string, unknown>>(`/api/v1/public/track/${token}`)).data,
    retry: false,
    refetchInterval: 15_000,
    refetchIntervalInBackground: true,
  });

  function toggleLanguage() {
    const next = ar ? "en" : "ar";
    void i18n.changeLanguage(next);
    applyDir(next);
  }

  if (query.isLoading) {
    return (
      <main className="grid min-h-screen place-items-center bg-paper p-6 text-sm text-ink-muted">
        {tx("loadingTracking", "Loading tracking summary…")}
      </main>
    );
  }

  if (query.isError) {
    return (
      <main className="grid min-h-screen place-items-center bg-paper p-4">
        <section className="w-full max-w-lg rounded-2xl border border-line bg-card p-6 shadow-[var(--shadow-card)]">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent-2 text-white"><Ship className="h-4 w-4" /></span>
            <p className="text-sm font-semibold text-ink">{productName}</p>
          </div>
          <h1 className="mt-4 text-2xl font-semibold">{tx("trackingUnavailable", "Tracking unavailable")}</h1>
          <p className="mt-2 text-sm text-ink-muted">
            {tx("errors.CUSTOMER_TRACKING_UNAVAILABLE", tx("trackingUnavailableBody", "This link is expired, revoked, or invalid."))}
          </p>
        </section>
      </main>
    );
  }

  const data = query.data!;
  const containers = (data.containers as Array<Record<string, unknown>> | undefined) ?? [];
  const documents = (data.documents as TrackDocument[] | undefined) ?? [];
  const timeline = (data.timeline as UnifiedTimelineEvent[] | undefined) ?? [];
  const customerFiles = (data.customerFiles as CustomerFileCard[] | undefined) ?? [];
  const etd = String(data.actualEtd || data.plannedEtd || tx("notConfirmed", "Not yet confirmed"));
  const eta = String(data.actualEta || data.plannedEta || tx("notConfirmed", "Not yet confirmed"));
  const loading = String(data.actualLoadingDate || data.plannedLoadingDate || tx("notConfirmed", "Not yet confirmed"));

  return (
    <main className="min-h-screen bg-paper" data-track="ready">
      <header className="relative overflow-hidden bg-accent-2 text-white">
        <div className="pointer-events-none absolute -end-24 -top-28 h-72 w-72 rounded-full bg-accent/25 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-32 start-1/4 h-64 w-64 rounded-full bg-accent/10 blur-3xl" aria-hidden />
        <div className="relative mx-auto max-w-5xl px-4 py-4 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/10 ring-1 ring-white/15">
                <Ship className="h-5 w-5" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold tracking-wide">{productName}</span>
                <span className="block truncate text-xs text-white/65">{String(data.exporterDisplayName)}</span>
              </span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0 rounded-full border border-white/25 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              onClick={toggleLanguage}
              aria-label={ar ? "Switch to English" : "التبديل إلى العربية"}
            >
              {ar ? "EN" : "ع"}
            </Button>
          </div>
          <div className="mt-4 pb-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/55">
              {tx("trackingTitle", "Shipment tracking")}
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl"><Ltr>{String(data.caseReference)}</Ltr></h1>
            <div className="mt-3 flex flex-wrap gap-1.5 text-xs text-white/75">
              <span className="rounded-full bg-white/10 px-3 py-1">
                {tx("plannedLoading", "Loading")}: <Ltr>{loading}</Ltr>
              </span>
              <span className="rounded-full bg-white/10 px-3 py-1">
                {tx("etd", "ETD")}: <Ltr>{etd}</Ltr>
              </span>
              <span className="rounded-full bg-white/10 px-3 py-1">
                {tx("eta", "ETA")}: <Ltr>{eta}</Ltr>
              </span>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto mt-3 max-w-5xl space-y-3 px-4 pb-6 sm:px-6">
        <DualLane
          documentTitle={tx("publicDocuments", "Documents")}
          documentStatus={String(data.documentTrackStatus)}
          documentHint={<>{tx("routeLabel", "Route")} {tx(`status.${String(data.documentRoute)}`, String(data.documentRoute))}</>}
          documentSteps={[
            { key: "NOT_STARTED", label: tx("status.NOT_STARTED", "Not started") },
            { key: "INTERNAL_REVIEW", label: tx("status.INTERNAL_REVIEW", "Internal review") },
            { key: "DISPATCHED", label: tx("status.DISPATCHED", "Dispatched") },
            { key: "DOCUMENTS_DELIVERED", label: tx("status.DOCUMENTS_DELIVERED", "Documents delivered") },
          ]}
          documentCurrent={String(data.documentTrackStatus)}
          goodsTitle={tx("publicGoods", "Goods")}
          goodsStatus={String(data.goodsTrackStatus)}
          goodsHint={tx("portNotDelivery", "Port arrival is not the same as customer delivery.")}
          goodsSteps={[
            { key: "PLANNED", label: tx("status.PLANNED", "Planned") },
            { key: "DEPARTED", label: tx("status.DEPARTED", "Departed") },
            { key: "ARRIVED_PORT", label: tx("status.ARRIVED_PORT", "Arrived port") },
            { key: "DELIVERED_TO_CUSTOMER", label: tx("status.DELIVERED_TO_CUSTOMER", "Delivered to customer") },
          ]}
          goodsCurrent={String(data.goodsTrackStatus)}
        />

        <div className="grid items-start gap-3 lg:grid-cols-2">
          <CustomerTimeline events={timeline} language={i18n.language} />
          <CustomerDocuments token={String(token ?? "")} documents={documents} files={customerFiles} />
        </div>

        <div className="grid items-start gap-3 lg:grid-cols-2">
        {containers.length ? (
          <section className="rounded-2xl border border-line bg-card p-3 shadow-[var(--shadow-card)]">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent/10 text-accent">
                <Boxes className="h-4 w-4" aria-hidden />
              </span>
              <h2 className="text-[15px] font-semibold text-ink">{tx("containers", "Containers")}</h2>
              <span className="ms-auto rounded-full bg-paper px-2 py-0.5 text-xs font-semibold tabular-nums text-ink-muted">
                {containers.length}
              </span>
            </div>
            <div className="mt-2 grid gap-2">
              {containers.map((container) => (
                <div key={String(container.slot)} className="rounded-xl border border-line/70 bg-paper/40 p-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-card text-xs font-semibold text-ink-muted ring-1 ring-line">
                        <Ltr>{String(container.slot)}</Ltr>
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[11px] text-ink-muted">{tx("slot", "Slot")} <Ltr>{String(container.slot)}</Ltr></span>
                        <span className="block truncate text-sm font-semibold text-ink">
                          {container.officialNumber
                            ? <Ltr>{String(container.officialNumber)}</Ltr>
                            : tx("numberPending", "number pending")}
                        </span>
                      </span>
                    </div>
                    <StatusBadge value={String(container.status)} />
                  </div>
                  <div className="mt-2"><SlotRail status={String(container.status)} /></div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="rounded-2xl border border-line bg-card p-3 shadow-[var(--shadow-card)]">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent/10 text-accent">
              <Truck className="h-4 w-4" aria-hidden />
            </span>
            <h2 className="text-[15px] font-semibold text-ink">{tx("logistics", "Logistics")}</h2>
          </div>
          <dl className="mt-2 grid gap-2">
            <InfoRow icon={<FileText className="h-4 w-4" aria-hidden />} label={tx("invoice", "Invoice")}>
              <Ltr>{String(data.invoiceNumber || tx("hidden", "hidden"))}</Ltr>
            </InfoRow>
            <InfoRow icon={<CalendarClock className="h-4 w-4" aria-hidden />} label={`${tx("etd", "ETD")} / ${tx("eta", "ETA")}`}>
              <Ltr>{etd}</Ltr>
              <span className="mx-1 text-ink-muted">·</span>
              <Ltr>{eta}</Ltr>
            </InfoRow>
            <InfoRow icon={<Ship className="h-4 w-4" aria-hidden />} label={tx("carrier", "Carrier")}>
              <span className="flex flex-wrap items-center gap-2">
                <Ltr>{String(data.courierCarrier || "—")}</Ltr>
                <Ltr>{String(data.courierTrackingNumber || "—")}</Ltr>
                {data.courierStatus ? <StatusBadge value={String(data.courierStatus)} /> : null}
              </span>
            </InfoRow>
            {data.courierTrackingUrl ? (
              <a
                className="flex items-center gap-2.5 rounded-xl border border-accent/30 bg-accent/5 p-3 text-sm font-semibold text-accent transition hover:border-accent/60"
                href={String(data.courierTrackingUrl)}
                rel="noreferrer"
                target="_blank"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-card ring-1 ring-line">
                  <ExternalLink className="h-4 w-4" aria-hidden />
                </span>
                {tx("carrierTracking", "Carrier tracking")}
              </a>
            ) : null}
          </dl>
        </section>
        </div>

        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] leading-relaxed text-ink-muted">
          <span>{tx("manualSourceNote", "Courier and milestone dates are entered manually. This is not a live carrier feed.")}</span>
          <span className="inline-flex items-center gap-1">
            <CalendarClock className="h-3.5 w-3.5" aria-hidden />
            {tx("lastUpdated", "Last updated")} <Ltr>{formatWhen(String(data.lastUpdatedAt), i18n.language)}</Ltr>
          </span>
        </p>
      </div>
    </main>
  );
}
