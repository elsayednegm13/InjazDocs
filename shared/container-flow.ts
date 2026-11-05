import type { ContainerStatus } from "./enums";

/**
 * Allowed container status transitions. Shared so the API and the workspace UI agree on
 * which "next stage" a container may move to (the API still re-validates every request).
 */
export const CONTAINER_FLOW: Record<ContainerStatus, readonly ContainerStatus[]> = {
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

/** The stages that advance the journey, in order, for the progress rail. */
export const CONTAINER_JOURNEY: readonly ContainerStatus[] = [
  "PLANNED",
  "NUMBER_ASSIGNED",
  "GATED_IN",
  "LOADED",
  "DEPARTED",
  "ARRIVED_PORT",
  "CUSTOMS_RELEASED",
  "DELIVERED_TO_CUSTOMER",
];

export function nextContainerStatuses(from: string): readonly ContainerStatus[] {
  return CONTAINER_FLOW[from as ContainerStatus] ?? [];
}

/** Index of a status on the journey rail (-1 for CANCELLED / EXCEPTION / unknown). */
export function containerJourneyIndex(status: string): number {
  return CONTAINER_JOURNEY.indexOf(status as ContainerStatus);
}
