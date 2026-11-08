import { describe, expect, it } from "vitest";
import { bothPartiesApproved, customerAcceptancePending, customerReviewLocked, customerSeesFile, normalizeCustomerFileDecision } from "../shared/customer-file-share";

describe("customer file decision", () => {
  it("accepts a file without turning it into an internal approval", () => {
    expect(normalizeCustomerFileDecision("ACCEPTED", "ignored")).toEqual({ decision: "ACCEPTED", comment: null });
    expect(normalizeCustomerFileDecision("APPROVED", "")).toEqual({ error: "decision" });
  });

  it("requires a note when the customer asks for another review", () => {
    expect(normalizeCustomerFileDecision("CHANGES_REQUESTED", "  ")).toEqual({ error: "comment_required" });
    expect(normalizeCustomerFileDecision("CHANGES_REQUESTED", "صحّح الوزن الصافي")).toEqual({
      decision: "CHANGES_REQUESTED",
      comment: "صحّح الوزن الصافي",
    });
    expect(normalizeCustomerFileDecision("CHANGES_REQUESTED", "x".repeat(1001))).toEqual({ error: "too_long" });
  });

  it("shows a file after it is sent for review, and keeps the two approvals independent", () => {
    expect(customerSeesFile({ sentForReview: false, archived: false })).toBe(false);
    expect(customerSeesFile({ sentForReview: true, archived: true })).toBe(false);
    expect(customerSeesFile({ sentForReview: true, archived: false })).toBe(true);
    expect(bothPartiesApproved("APPROVED", "ACCEPTED")).toBe(true);
    expect(bothPartiesApproved("UPLOADED", "ACCEPTED")).toBe(false);
    expect(bothPartiesApproved("APPROVED", null)).toBe(false);
    expect(customerReviewLocked("ACCEPTED", false)).toBe(true);
    expect(customerReviewLocked("ACCEPTED", true)).toBe(false);
    expect(customerReviewLocked("CHANGES_REQUESTED", false)).toBe(false);
  });

  it("asks for confirmation only while the current published file is not accepted", () => {
    const accepted = { requirementId: "req-1", version: 2, published: true, decision: "ACCEPTED" as const };
    expect(customerAcceptancePending([accepted])).toBe(false);
    expect(customerAcceptancePending([{ ...accepted, decision: null }])).toBe(true);
    expect(customerAcceptancePending([{ ...accepted, decision: "CHANGES_REQUESTED" }])).toBe(true);
    expect(customerAcceptancePending([{ ...accepted, published: false, decision: null }])).toBe(false);
    expect(customerAcceptancePending([
      { requirementId: "req-1", version: 1, published: true, decision: null },
      accepted,
    ])).toBe(false);
  });
});
