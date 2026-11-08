import { Ltr } from "@/components/ui/chrome";
import { formatWhen, useCopy } from "@/lib/copy";
import type { UnifiedTimelineEvent } from "@shared/customer-timeline";

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
  return (
    <section className="rounded-2xl border border-line bg-card p-4 shadow-[var(--shadow-card)]">
      <h2 className="text-[15px] font-semibold text-ink">{tx("timelineTitle", "Shipment timeline")}</h2>
      {events.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">{tx("timelineEmpty", "No movements have been recorded yet.")}</p>
      ) : (
        <ol className="mt-4">
          {events.map((event, index) => (
            <li key={`${event.occurredAt}-${event.source}-${event.code}-${event.slot ?? ""}-${index}`} className="relative ps-6 pb-4 last:pb-0">
              <span className="absolute start-[3px] top-1.5 h-2.5 w-2.5 rounded-full bg-accent" aria-hidden />
              {index < events.length - 1 ? <span className="absolute start-[7px] top-4 h-[calc(100%-0.75rem)] w-px bg-line" aria-hidden /> : null}
              <p className="text-xs text-ink-muted"><Ltr>{formatWhen(event.occurredAt, language)}</Ltr></p>
              <p className="mt-0.5 text-sm font-medium text-ink">{eventTitle(event, tx)}</p>
              <p className="text-xs text-ink-muted">
                {tx(`timelineSource.${event.source}`, event.source)}
                {event.planned ? ` · ${tx("timelinePlanned", "Planned")}` : ""}
                {event.slot != null ? ` · ${tx("slot", "Slot")} ` : ""}
                {event.slot != null ? <Ltr>{event.slot}</Ltr> : null}
                {event.reference && event.source !== "documents" ? " · " : ""}
                {event.reference && event.source !== "documents" ? <Ltr>{event.reference}</Ltr> : null}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function eventTitle(event: UnifiedTimelineEvent, tx: (key: string, fallback: string) => string) {
  if (event.source === "documents") {
    const shared = tx("timeline.documents.SHARED", "A file was sent for your review");
    const known = event.reference ? DOCUMENT_LABELS[event.reference] : undefined;
    return known ? `${shared} · ${tx(known[0], known[1])}` : shared;
  }
  return tx(`timeline.${event.source}.${event.code}`, event.code);
}
