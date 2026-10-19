import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { applyDir } from "@/app/i18n";
import { DualLane, Ltr, SectionCard } from "@/components/ui/chrome";
import { StatusBadge } from "@/components/ui/status";
import { api } from "@/lib/api";
import { formatWhen, useCopy } from "@/lib/copy";

export function TrackPage() {
  const { token } = useParams();
  const { tx, i18n } = useCopy();
  const ar = i18n.language.startsWith("ar");
  const query = useQuery({
    queryKey: ["track", token],
    queryFn: async () => (await api<Record<string, unknown>>(`/api/v1/public/track/${token}`)).data,
    retry: false,
  });
  if (query.isLoading) return <main className="mx-auto max-w-2xl p-6 text-ink-muted">{tx("loadingTracking", "Loading tracking summary…")}</main>;
  if (query.isError) {
    return (
      <main className="mx-auto max-w-lg p-6">
        <section className="rounded-2xl border border-line bg-card p-6 shadow-[var(--shadow-card)]">
          <p className="text-xs font-semibold text-accent">ExportFlow</p>
          <h1 className="mt-3 text-2xl font-semibold">{tx("trackingUnavailable", "Tracking unavailable")}</h1>
          <p className="mt-2 text-ink-muted">
            {tx("errors.CUSTOMER_TRACKING_UNAVAILABLE", tx("trackingUnavailableBody", "This link is expired, revoked, or invalid."))}
          </p>
        </section>
      </main>
    );
  }
  const data = query.data!;
  return (
    <main className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-accent">ExportFlow</p>
          <p className="mt-2 text-sm text-ink-muted">{String(data.exporterDisplayName)}</p>
          <h1 className="text-2xl font-semibold">
            <Ltr>{String(data.caseReference)}</Ltr>
          </h1>
        </div>
        <button
          className="rounded-lg border border-line bg-card px-2.5 py-1 text-xs font-semibold"
          onClick={() => {
            const next = ar ? "en" : "ar";
            void i18n.changeLanguage(next);
            applyDir(next);
          }}
        >
          {ar ? "EN" : "ع"}
        </button>
      </div>
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
      <SectionCard>
        <ul className="space-y-1 text-sm">
          {(data.containers as Array<Record<string, unknown>> | undefined)?.map((c) => (
            <li key={String(c.slot)}>
              {tx("slot", "Slot")} {String(c.slot)} · <Ltr>{String(c.officialNumber || tx("numberPending", "number pending"))}</Ltr> ·{" "}
              <StatusBadge value={String(c.status)} />
            </li>
          ))}
        </ul>
      </SectionCard>
      <SectionCard>
        <p>
          {tx("invoice", "Invoice")} <Ltr>{String(data.invoiceNumber || tx("hidden", "hidden"))}</Ltr>
        </p>
        <p>
          {tx("etd", "ETD")} <Ltr>{String(data.actualEtd || data.plannedEtd || tx("notConfirmed", "Not yet confirmed"))}</Ltr>
          {" · "}
          {tx("eta", "ETA")} <Ltr>{String(data.actualEta || data.plannedEta || tx("notConfirmed", "Not yet confirmed"))}</Ltr>
        </p>
        <p>
          {tx("carrier", "Carrier")} <Ltr>{String(data.courierCarrier || "—")}</Ltr>
          {" · "}
          <Ltr>{String(data.courierTrackingNumber || "—")}</Ltr>
          {" · "}
          {data.courierStatus ? <StatusBadge value={String(data.courierStatus)} /> : "—"}
        </p>
        {data.courierTrackingUrl ? (
          <a className="mt-2 inline-block text-sm font-medium text-accent underline" href={String(data.courierTrackingUrl)} rel="noreferrer" target="_blank">
            {tx("carrierTracking", "Carrier tracking")}
          </a>
        ) : null}
        <p className="mt-3 text-sm text-ink-muted">{String(data.attribution)}</p>
        <p className="text-sm text-ink-muted">{tx("manualSourceNote", "Courier and milestone dates are entered manually. This is not a live carrier feed.")}</p>
        <p className="text-sm text-ink-muted">
          {tx("lastUpdated", "Last updated")} {formatWhen(String(data.lastUpdatedAt), i18n.language)}
        </p>
      </SectionCard>
    </main>
  );
}
