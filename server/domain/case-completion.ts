import type { CaseStatus, ContainerStatus, DocumentRoute } from "../../shared/enums";
import { documentTrackComplete, goodsTrackComplete } from "./transitions";

export function canCompleteCase(input: {
  status: CaseStatus;
  route: DocumentRoute;
  bankStatus: Parameters<typeof documentTrackComplete>[0]["bankStatus"];
  directStatus: Parameters<typeof documentTrackComplete>[0]["directStatus"];
  containers: { status: ContainerStatus }[];
  requirements?: { required: number; status: string }[];
  exceptionReason?: string | null;
  hasClosePermission: boolean;
}): { ok: true } | { ok: false; code: string; message: string } {
  if (input.status !== "ACTIVE" && input.status !== "ON_HOLD") {
    return { ok: false, code: "CASE_NOT_COMPLETABLE", message: "Only active or held cases can be completed" };
  }
  const requiredReady = (input.requirements ?? [])
    .filter((item) => item.required)
    .every((item) => item.status === "APPROVED" || item.status === "WAIVED");
  const docsDone = requiredReady && documentTrackComplete({
    route: input.route,
    bankStatus: input.bankStatus,
    directStatus: input.directStatus,
  });
  const goodsDone = goodsTrackComplete(input.containers);
  if (docsDone && goodsDone) return { ok: true };
  if (input.exceptionReason && input.hasClosePermission) return { ok: true };
  if (!docsDone) {
    return {
      ok: false,
      code: "DOCUMENTS_TRACK_INCOMPLETE",
      message: "Case cannot complete until the document delivery track is fulfilled",
    };
  }
  return {
    ok: false,
    code: "GOODS_TRACK_INCOMPLETE",
    message: "Port arrival is not customer delivery. All expected containers must be delivered unless an authorized exception is recorded.",
  };
}

export function bookingAggregateFromContainers(
  expectedCount: number,
  containers: { status: ContainerStatus; officialNumber: string | null }[],
): {
  registeredCount: number;
  loadedCount: number;
  deliveredCount: number;
  suggestedStatus: "CONFIRMED" | "LOADING_IN_PROGRESS" | "LOADED" | "DEPARTED" | "ARRIVED_PORT" | "CLOSED";
} {
  const active = containers.filter((c) => c.status !== "CANCELLED");
  const registeredCount = active.filter((c) => Boolean(c.officialNumber)).length;
  const loadedCount = active.filter((c) =>
    ["LOADED", "DEPARTED", "ARRIVED_PORT", "CUSTOMS_RELEASED", "DELIVERED_TO_CUSTOMER"].includes(c.status),
  ).length;
  const deliveredCount = active.filter((c) => c.status === "DELIVERED_TO_CUSTOMER").length;
  const departedCount = active.filter((c) =>
    ["DEPARTED", "ARRIVED_PORT", "CUSTOMS_RELEASED", "DELIVERED_TO_CUSTOMER"].includes(c.status),
  ).length;
  const arrivedCount = active.filter((c) =>
    ["ARRIVED_PORT", "CUSTOMS_RELEASED", "DELIVERED_TO_CUSTOMER"].includes(c.status),
  ).length;

  let suggestedStatus: "CONFIRMED" | "LOADING_IN_PROGRESS" | "LOADED" | "DEPARTED" | "ARRIVED_PORT" | "CLOSED" = "CONFIRMED";
  if (active.length > 0 && deliveredCount === active.length) suggestedStatus = "CLOSED";
  else if (active.length > 0 && arrivedCount === active.length) suggestedStatus = "ARRIVED_PORT";
  else if (active.length > 0 && departedCount === active.length) suggestedStatus = "DEPARTED";
  else if (active.length > 0 && loadedCount === active.length && loadedCount > 0) suggestedStatus = "LOADED";
  else if (loadedCount > 0) suggestedStatus = "LOADING_IN_PROGRESS";

  void expectedCount;
  return { registeredCount, loadedCount, deliveredCount, suggestedStatus };
}
