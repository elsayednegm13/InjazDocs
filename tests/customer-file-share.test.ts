import { describe, expect, it } from "vitest";
import { bothPartiesApproved, normalizeCustomerFileDecision, visibleToCustomer } from "../shared/customer-file-share";

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

  it("shows a file to the customer only after the employee approves it", () => {
    expect(visibleToCustomer("UPLOADED")).toBe(false);
    expect(visibleToCustomer("UNDER_REVIEW")).toBe(false);
    expect(visibleToCustomer("APPROVED")).toBe(true);
    expect(bothPartiesApproved("APPROVED", "ACCEPTED")).toBe(true);
    expect(bothPartiesApproved("UPLOADED", "ACCEPTED")).toBe(false);
    expect(bothPartiesApproved("APPROVED", "CHANGES_REQUESTED")).toBe(false);
  });
});
