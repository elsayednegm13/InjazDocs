export const CUSTOMER_FILE_COMMENT_MAX = 1000;

export type CustomerFileDecision = "ACCEPTED" | "CHANGES_REQUESTED";

export type CustomerFileCard = {
  versionId: string;
  nameEn: string;
  nameAr: string;
  fileName: string;
  byteSize: number;
  version: number;
  decision: CustomerFileDecision | null;
  comment: string | null;
  viewed: boolean;
};

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
