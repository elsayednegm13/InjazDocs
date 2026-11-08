export const CUSTOMER_FILE_COMMENT_MAX = 1000;

export type CustomerFileDecision = "ACCEPTED" | "CHANGES_REQUESTED";

export type CustomerFileCard = {
  requirementId: string;
  versionId: string;
  nameEn: string;
  nameAr: string;
  fileName: string;
  byteSize: number;
  version: number;
  decision: CustomerFileDecision | null;
  comment: string | null;
  viewed: boolean;
  revisionOpen: boolean;
};

/** After the customer accepts, the review stays closed until the company opens it again. */
export function customerReviewLocked(decision: string | null, revisionOpen: boolean) {
  return decision === "ACCEPTED" && !revisionOpen;
}

/** The customer sees the current file only after it is sent for their review and it is not archived. */
export function customerSeesFile(input: { sentForReview: boolean; archived: boolean }) {
  return input.sentForReview && !input.archived;
}

/** Both approvals count only when the employee has approved the same current file. */
export function bothPartiesApproved(staffStatus: string, decision: string | null) {
  return staffStatus === "APPROVED" && decision === "ACCEPTED";
}

export type CustomerVersionAcceptance = {
  requirementId: string;
  version: number;
  published: boolean;
  decision: string | null;
};

/** A current file sent to the customer still needs their acceptance. Older versions do not count. */
export function customerAcceptancePending(versions: CustomerVersionAcceptance[]) {
  const latest = new Map<string, CustomerVersionAcceptance>();
  for (const row of versions) {
    const current = latest.get(row.requirementId);
    if (!current || row.version >= current.version) latest.set(row.requirementId, row);
  }
  for (const row of latest.values()) {
    if (row.published && row.decision !== "ACCEPTED") return true;
  }
  return false;
}

export function normalizeCustomerFileDecision(
  decision: unknown,
  comment: unknown,
): { decision: "ACCEPTED"; comment: null } | { decision: "CHANGES_REQUESTED"; comment: string } | { error: "decision" | "comment_required" | "too_long" } {
  if (decision !== "ACCEPTED" && decision !== "CHANGES_REQUESTED") return { error: "decision" };
  const text = typeof comment === "string"
    ? comment.replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim()
    : "";
  if (decision === "ACCEPTED") return { decision, comment: null };
  if (!text) return { error: "comment_required" };
  if (text.length > CUSTOMER_FILE_COMMENT_MAX) return { error: "too_long" };
  return { decision: "CHANGES_REQUESTED", comment: text };
}
