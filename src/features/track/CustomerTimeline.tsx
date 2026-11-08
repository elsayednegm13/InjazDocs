import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Ltr } from "@/components/ui/chrome";
import { formatWhen, useCopy } from "@/lib/copy";
import { splitCustomerTimeline, type UnifiedTimelineEvent } from "@shared/customer-timeline";

const PREVIEW = 4;
const SHIPMENT_STEPS = ["LOADED", "DEPARTED", "ARRIVED_PORT", "CUSTOMS_RELEASED", "DELIVERED_TO_CUSTOMER"];
const DOCUMENT_STEPS = ["SHARED", "ACCEPTED", "DISPATCHED", "DELIVERED"];

const DOCUMENT_LABELS: Record<string, [string, string]> = {
  commercial_invoice: ["timeline.doc.commercial_invoice", "Commercial invoice"],
  packing_list: ["timeline.doc.packing_list", "Packing list"],
  bill_of_lading: ["timeline.doc.bill_of_lading", "Bill of lading"],
  certificate_of_origin: ["timeline.doc.certificate_of_origin", "Certificate of origin"],
  booking_confirmation: ["timeline.doc.booking_confirmation", "Booking confirmation"],
  technical_certificate: ["timeline.doc.technical_certificate", "Technical certificate"],
  professional_certificate: ["timeline.doc.professional_certificate", "Professional certificate"],
  bank_cover_letter: ["timeline.doc.bank_cover_letter", "Bank cover letter"],
};

export function CustomerTimeline({ events, language }: { events: UnifiedTimelineEvent[]; language: string }) {
  const { tx } = useCopy();
  const tracks = splitCustomerTimeline(events);
  const [track, setTrack] = useState<"shipment" | "documents">("shipment");
  const [slot, setSlot] = useState<number | "all">("all");
  const [open, setOpen] = useState(false);
  const selected = track === "shipment" ? tracks.shipment : tracks.documents;
  const filtered = track === "shipment" && slot !== "all"
    ? selected.filter((event) => event.source === "booking" || event.slot === slot)
    : selected;
  const newestFirst = [...filtered].reverse();
  const visible = open ? newestFirst : newestFirst.slice(0, PREVIEW);
  const hiddenCount = Math.max(0, newestFirst.length - PREVIEW);
  const slots = [...new Set(tracks.shipment.flatMap((event) => event.slot == null ? [] : [event.slot]))].sort((a, b) => a - b);
  const steps = track === "shipment" ? SHIPMENT_STEPS : DOCUMENT_STEPS;
  const current = stepIndex(filtered, steps);
  const latest = filtered.at(-1);

  function chooseTrack(next: "shipment" | "documents") {
    setTrack(next);
    setSlot("all");
    setOpen(false);
  }

  return (
    <section className="rounded-2xl border border-line bg-card p-3 shadow-[var(--shadow-card)]">
      <h2 className="text-sm font-semibold text-ink">{tx("timelineTitle", "Shipment timeline")}</h2>
      <div className="mt-2 grid grid-cols-2 gap-1 rounded-full bg-paper p-1" role="tablist" aria-label={tx("timelineTitle", "Shipment timeline")}>
        <TrackTab
          selected={track === "shipment"}
          label={tx("timelineTrackShipment", "Shipment and containers")}
          badge={latestLabel(tracks.shipment.at(-1), tx)}
          onClick={() => chooseTrack("shipment")}
        />
        <TrackTab
          selected={track === "documents"}
          label={tx("timelineTrackDocuments", "Documents and courier")}
          badge={latestLabel(tracks.documents.at(-1), tx)}
          onClick={() => chooseTrack("documents")}
        />
      </div>
      <div className="mt-3" role="tabpanel">
        <p className="text-xs text-ink-muted">
          {tx("timelineNow", "Now")}: <span className="font-medium text-ink">{latest ? eventTitle(latest, tx) : tx(track === "shipment" ? "timelineEmptyShipment" : "timelineEmptyDocuments", "No movements yet.")}</span>
        </p>
        <div className="mt-2 flex gap-1" aria-hidden>
          {steps.map((step, index) => (
            <span key={step} className={`h-1 flex-1 rounded-full ${index <= current ? "bg-accent" : "bg-line"}`} />
          ))}
        </div>
        {track === "shipment" && slots.length > 1 ? (
          <div className="mt-2 flex flex-wrap gap-1">
            <FilterPill selected={slot === "all"} onClick={() => { setSlot("all"); setOpen(false); }}>{tx("timelineAllContainers", "All")}</FilterPill>
            {slots.map((item) => (
              <FilterPill key={item} selected={slot === item} onClick={() => { setSlot(item); setOpen(false); }}>
                {tx("timelineContainer", "Container")} <Ltr>{item}</Ltr>
              </FilterPill>
            ))}
          </div>
        ) : null}
        {visible.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">{tx(track === "shipment" ? "timelineEmptyShipment" : "timelineEmptyDocuments", "No movements yet.")}</p>
        ) : (
          <ol className="mt-3">
            {visible.map((event, index) => (
              <li key={`${event.occurredAt}-${event.source}-${event.code}-${event.slot ?? ""}-${index}`} className="relative ps-5 pb-2.5 last:pb-0">
                <span className="absolute start-[3px] top-1.5 h-2 w-2 rounded-full bg-accent" aria-hidden />
                {index < visible.length - 1 ? <span className="absolute start-[6px] top-3.5 h-[calc(100%-0.4rem)] w-px bg-line" aria-hidden /> : null}
                <p className="text-[11px] text-ink-muted"><Ltr>{formatWhen(event.occurredAt, language)}</Ltr></p>
                <p className="text-sm font-medium leading-5 text-ink">{eventTitle(event, tx)}</p>
                <p className="text-[11px] text-ink-muted">
                  {tx(`timelineSource.${event.source}`, event.source)}
                  {event.planned ? ` · ${tx("timelinePlanned", "Planned")}` : ""}
                  {event.slot != null ? ` · ${tx("timelineContainer", "Container")} ` : null}
                  {event.slot != null ? <Ltr>{event.slot}</Ltr> : null}
                  {event.reference && event.source === "container" ? " · " : null}
                  {event.reference && event.source === "container" ? <Ltr>{event.reference}</Ltr> : null}
                </p>
              </li>
            ))}
          </ol>
        )}
        {hiddenCount > 0 ? (
          <Button type="button" variant="ghost" size="sm" className="mt-2 h-8 px-2 text-xs" onClick={() => setOpen((value) => !value)}>
            {open
              ? tx("timelineHideEarlier", "Hide the record")
              : `${tx("timelineShowEarlier", "Show earlier movements")} (${hiddenCount})`}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function TrackTab({ selected, label, badge, onClick }: { selected: boolean; label: string; badge: string | null; onClick: () => void }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      className={`min-w-0 rounded-full px-2 py-1.5 text-start text-[11px] font-semibold leading-4 ${selected ? "bg-card text-ink shadow-sm" : "text-ink-muted"}`}
      onClick={onClick}
    >
      <span className="block truncate">{label}</span>
      {badge ? <span className="mt-0.5 block truncate text-[10px] font-medium text-ink-muted">{badge}</span> : null}
    </button>
  );
}

function FilterPill({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${selected ? "border-accent bg-accent/10 text-ink" : "border-line text-ink-muted"}`}
      aria-pressed={selected}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function stepIndex(events: UnifiedTimelineEvent[], steps: string[]) {
  for (const event of [...events].reverse()) {
    if (event.code === "CHANGES_REQUESTED" && steps.includes("ACCEPTED")) return steps.indexOf("ACCEPTED");
    if (event.source === "booking" && event.code === "ETA" && !event.planned && steps.includes("ARRIVED_PORT")) return steps.indexOf("ARRIVED_PORT");
    if (event.source === "booking" && event.code === "ETD" && !event.planned && steps.includes("DEPARTED")) return steps.indexOf("DEPARTED");
    const index = steps.indexOf(event.code);
    if (index >= 0) return index;
  }
  return -1;
}

function latestLabel(event: UnifiedTimelineEvent | undefined, tx: (key: string, fallback: string) => string) {
  return event ? eventTitle(event, tx) : null;
}

function eventTitle(event: UnifiedTimelineEvent, tx: (key: string, fallback: string) => string) {
  if (event.source === "documents") {
    const action = tx(`timeline.documents.${event.code}`, event.code);
    const known = event.reference ? DOCUMENT_LABELS[event.reference] : undefined;
    return known ? `${action} · ${tx(known[0], known[1])}` : action;
  }
  return tx(`timeline.${event.source}.${event.code}`, event.code);
}
