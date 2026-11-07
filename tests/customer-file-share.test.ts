import { describe, expect, it } from "vitest";
import { bothPartiesApproved, customerSeesFile, normalizeCustomerFileDecision } from "../shared/customer-file-share";

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
  });
});
