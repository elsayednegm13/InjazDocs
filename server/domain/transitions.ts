import type {
  BankPathStatus,
  BookingStatus,
  CaseStatus,
  ContainerStatus,
  CourierStatus,
  DirectPathStatus,
  DocumentRequirementStatus,
  DocumentRoute,
} from "../../shared/enums";

export class TransitionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "TransitionError";
  }
}

function allow<T extends string>(
  from: T,
  to: T,
  map: Record<T, readonly T[]>,
  label: string,
): void {
  if (from === to) return;
  if (!map[from]?.includes(to)) {
    throw new TransitionError(
      "INVALID_TRANSITION",
      `${label} cannot move from ${from} to ${to}`,
      { from, to, label },
    );
  }
}

const DOCUMENT_MAP: Record<DocumentRequirementStatus, readonly DocumentRequirementStatus[]> = {
  MISSING: ["UPLOADED", "WAIVED"],
  UPLOADED: ["UNDER_REVIEW", "NEEDS_CORRECTION", "MISSING"],
  UNDER_REVIEW: ["APPROVED", "NEEDS_CORRECTION"],
  APPROVED: ["NEEDS_CORRECTION"],
  NEEDS_CORRECTION: ["UPLOADED", "WAIVED"],
  WAIVED: ["MISSING"],
};

const BANK_MAP: Record<BankPathStatus, readonly BankPathStatus[]> = {
  NOT_REQUIRED: ["PREPARING"],
  PREPARING: ["SCANNED"],
  SCANNED: ["READY_FOR_PHYSICAL_HANDOVER"],
  READY_FOR_PHYSICAL_HANDOVER: ["HANDED_TO_BANK"],
  HANDED_TO_BANK: ["BANK_REVIEW"],
  BANK_REVIEW: ["CORRECTION_REQUESTED", "BANK_APPROVED"],
  CORRECTION_REQUESTED: ["PREPARING", "SCANNED", "READY_FOR_PHYSICAL_HANDOVER"],
  BANK_APPROVED: ["COURIER_DISPATCHED"],
  COURIER_DISPATCHED: ["DOCUMENTS_DELIVERED"],
  DOCUMENTS_DELIVERED: [],
};

const DIRECT_MAP: Record<DirectPathStatus, readonly DirectPathStatus[]> = {
  PREPARING: ["SCANNED"],
  SCANNED: ["INTERNAL_REVIEW"],
  INTERNAL_REVIEW: ["READY_FOR_DISPATCH", "PREPARING"],
  READY_FOR_DISPATCH: ["COURIER_DISPATCHED"],
  COURIER_DISPATCHED: ["DOCUMENTS_DELIVERED"],
  DOCUMENTS_DELIVERED: [],
};

const COURIER_MAP: Record<CourierStatus, readonly CourierStatus[]> = {
  NOT_DISPATCHED: ["DISPATCHED", "CANCELLED"],
  DISPATCHED: ["IN_TRANSIT", "DELIVERY_EXCEPTION", "DELIVERED", "RETURNED", "CANCELLED"],
  IN_TRANSIT: ["DELIVERY_EXCEPTION", "DELIVERED", "RETURNED", "CANCELLED"],
  DELIVERY_EXCEPTION: ["IN_TRANSIT", "DELIVERED", "RETURNED", "CANCELLED"],
  DELIVERED: ["RETURNED"],
  RETURNED: ["DISPATCHED", "CANCELLED"],
  CANCELLED: [],
};

const BOOKING_MAP: Record<BookingStatus, readonly BookingStatus[]> = {
  DRAFT: ["REQUESTED", "CONFIRMED", "CANCELLED"],
  REQUESTED: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["LOADING_IN_PROGRESS", "CANCELLED"],
  LOADING_IN_PROGRESS: ["LOADED", "CONFIRMED", "CANCELLED"],
  LOADED: ["DEPARTED", "LOADING_IN_PROGRESS"],
  DEPARTED: ["ARRIVED_PORT"],
  ARRIVED_PORT: ["CLOSED"],
  CLOSED: [],
  CANCELLED: [],
};

const CONTAINER_MAP: Record<ContainerStatus, readonly ContainerStatus[]> = {
  PLANNED: ["NUMBER_ASSIGNED", "CANCELLED"],
  NUMBER_ASSIGNED: ["GATED_IN", "PLANNED", "CANCELLED", "EXCEPTION"],
  GATED_IN: ["LOADED", "EXCEPTION", "CANCELLED"],
  LOADED: ["DEPARTED", "EXCEPTION"],
  DEPARTED: ["ARRIVED_PORT", "EXCEPTION"],
  ARRIVED_PORT: ["CUSTOMS_RELEASED", "EXCEPTION"],
  CUSTOMS_RELEASED: ["DELIVERED_TO_CUSTOMER", "EXCEPTION"],
  DELIVERED_TO_CUSTOMER: [],
  CANCELLED: [],
  EXCEPTION: ["NUMBER_ASSIGNED", "GATED_IN", "LOADED", "DEPARTED", "ARRIVED_PORT", "CANCELLED"],
};

const CASE_MAP: Record<CaseStatus, readonly CaseStatus[]> = {
  DRAFT: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["ON_HOLD", "COMPLETED", "CANCELLED"],
  ON_HOLD: ["ACTIVE", "CANCELLED"],
  COMPLETED: ["ACTIVE"],
  CANCELLED: ["DRAFT", "ACTIVE"],
  ARCHIVED: [],
};

export function assertDocumentTransition(from: DocumentRequirementStatus, to: DocumentRequirementStatus): void {
  allow(from, to, DOCUMENT_MAP, "document");
}

export function assertBankTransition(from: BankPathStatus, to: BankPathStatus): void {
  allow(from, to, BANK_MAP, "bank path");
}

export function assertDirectTransition(from: DirectPathStatus, to: DirectPathStatus): void {
  allow(from, to, DIRECT_MAP, "direct path");
}

export function assertCourierTransition(from: CourierStatus, to: CourierStatus): void {
  allow(from, to, COURIER_MAP, "courier");
}

export function assertBookingTransition(from: BookingStatus, to: BookingStatus): void {
  allow(from, to, BOOKING_MAP, "booking");
}

export function assertContainerTransition(from: ContainerStatus, to: ContainerStatus): void {
  allow(from, to, CONTAINER_MAP, "container");
}

export function assertCaseTransition(from: CaseStatus, to: CaseStatus): void {
  allow(from, to, CASE_MAP, "export case");
}

export function initialRouteStatus(route: DocumentRoute): {
  bank: BankPathStatus;
  direct: DirectPathStatus | null;
} {
  if (route === "BANK_ROUTE") {
    return { bank: "PREPARING", direct: null };
  }
  return { bank: "NOT_REQUIRED", direct: "PREPARING" };
}

export function assertRouteChange(
  from: DocumentRoute,
  to: DocumentRoute,
  currentBank: BankPathStatus,
): void {
  if (from === to) return;
  if (from === "BANK_ROUTE" && to === "DIRECT_ROUTE") {
    const blocked: BankPathStatus[] = ["HANDED_TO_BANK", "BANK_REVIEW", "COURIER_DISPATCHED"];
    if (blocked.includes(currentBank)) {
      throw new TransitionError(
        "ROUTE_CHANGE_BLOCKED",
        "Cannot switch to direct route while originals are with the bank or already dispatched",
        { from, to, currentBank },
      );
    }
  }
}

export function documentTrackComplete(input: {
  route: DocumentRoute;
  bankStatus: BankPathStatus;
  directStatus: DirectPathStatus | null;
}): boolean {
  if (input.route === "BANK_ROUTE") return input.bankStatus === "DOCUMENTS_DELIVERED";
  return input.directStatus === "DOCUMENTS_DELIVERED";
}

export function goodsTrackComplete(containers: { status: ContainerStatus }[]): boolean {
  const relevant = containers.filter((c) => c.status !== "CANCELLED");
  if (relevant.length === 0) return false;
  return relevant.every((c) => c.status === "DELIVERED_TO_CUSTOMER");
}
