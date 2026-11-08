export type TimelineSource = "container" | "booking" | "courier" | "documents";

export type UnifiedTimelineEvent = {
  occurredAt: string;
  source: TimelineSource;
  code: string;
  planned: boolean;
  slot: number | null;
  reference: string | null;
};

const CUSTOMER_CONTAINER = new Set(["LOADED", "DEPARTED", "ARRIVED_PORT", "CUSTOMS_RELEASED", "DELIVERED_TO_CUSTOMER"]);
const CUSTOMER_COURIER = new Set(["DISPATCHED", "IN_TRANSIT", "DELIVERED", "DELIVERY_EXCEPTION", "RETURNED", "CANCELLED"]);

export type CustomerTimelineTracks = {
  shipment: UnifiedTimelineEvent[];
  documents: UnifiedTimelineEvent[];
};

/** Shipment events stay on one track. Document and courier events stay on the other. */
export function splitCustomerTimeline(events: UnifiedTimelineEvent[]): CustomerTimelineTracks {
  return {
    shipment: events.filter((event) => event.source === "booking" || event.source === "container"),
    documents: events.filter((event) => event.source === "documents" || event.source === "courier"),
  };
}

export function buildCustomerTimeline(input: {
  showEta: boolean;
  showCourierTracking: boolean;
  showContainerNumbers: boolean;
  containers: Array<{ status: string; eventAt: string; slot: number; officialNumber: string | null }>;
  booking: {
    plannedEtd: string | null;
    actualEtd: string | null;
    plannedEta: string | null;
    actualEta: string | null;
  } | null;
  courier: Array<{ status: string; eventAt: string }>;
  documents: Array<{ publishedAt: string; typeKey: string; decision?: string | null; decidedAt?: string | null }>;
}): UnifiedTimelineEvent[] {
  const events: UnifiedTimelineEvent[] = [];
  for (const row of input.containers) {
    if (!CUSTOMER_CONTAINER.has(row.status)) continue;
    const occurredAt = present(row.eventAt);
    if (!occurredAt) continue;
    events.push({
      occurredAt,
      source: "container",
      code: row.status,
      planned: false,
      slot: row.slot,
      reference: input.showContainerNumbers ? present(row.officialNumber) : null,
    });
  }
  const booking = input.booking;
  if (booking) {
    pushBooking(events, "ETD", booking.plannedEtd, true);
    pushBooking(events, "ETD", booking.actualEtd, false);
    if (input.showEta) {
      pushBooking(events, "ETA", booking.plannedEta, true);
      pushBooking(events, "ETA", booking.actualEta, false);
    }
  }
  if (input.showCourierTracking) {
    for (const row of input.courier) {
      if (!CUSTOMER_COURIER.has(row.status)) continue;
      const occurredAt = present(row.eventAt);
      if (!occurredAt) continue;
      events.push({
        occurredAt,
        source: "courier",
        code: row.status,
        planned: false,
        slot: null,
        reference: null,
      });
    }
  }
  for (const row of input.documents) {
    const occurredAt = present(row.publishedAt);
    const typeKey = present(row.typeKey);
    if (!occurredAt || !typeKey) continue;
    events.push({
      occurredAt,
      source: "documents",
      code: "SHARED",
      planned: false,
      slot: null,
      reference: typeKey,
    });
    const decidedAt = present(row.decidedAt);
    if ((row.decision === "ACCEPTED" || row.decision === "CHANGES_REQUESTED") && decidedAt) {
      events.push({
        occurredAt: decidedAt,
        source: "documents",
        code: row.decision,
        planned: false,
        slot: null,
        reference: typeKey,
      });
    }
  }
  events.sort((a, b) => {
    const time = a.occurredAt.localeCompare(b.occurredAt);
    if (time !== 0) return time;
    if (a.planned !== b.planned) return a.planned ? 1 : -1;
    const source = a.source.localeCompare(b.source);
    if (source !== 0) return source;
    return a.code.localeCompare(b.code);
  });
  return events;
}

function pushBooking(events: UnifiedTimelineEvent[], code: "ETD" | "ETA", value: string | null, planned: boolean) {
  const occurredAt = present(value);
  if (!occurredAt) return;
  events.push({ occurredAt, source: "booking", code, planned, slot: null, reference: null });
}

function present(value: string | null | undefined) {
  const text = value?.trim() ?? "";
  return text || null;
}
