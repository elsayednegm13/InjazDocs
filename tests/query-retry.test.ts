import { describe, expect, it } from "vitest";
import { ApiRequestError } from "../src/lib/api";
import { dashboardFollowUp } from "../src/lib/dashboard-follow-up";
import { iconHrefNeedsUpdate, loginRequestGate, refetchWhenReadable, retryReadQuery } from "../src/lib/query-retry";

function httpError(status: number) {
  return new ApiRequestError(status, {
    error: { code: "REQUEST_FAILED", message: "failed", requestId: "test" },
  });
}

describe("retryReadQuery", () => {
  it("does not repeat a 4xx answer", () => {
    for (const status of [400, 401, 403, 404, 409, 422, 499]) {
      expect(retryReadQuery(0, httpError(status))).toBe(false);
    }
  });

  it("allows one retry for a dropped connection or a 5xx response", () => {
    expect(retryReadQuery(0, httpError(0))).toBe(true);
    expect(retryReadQuery(1, httpError(0))).toBe(false);
    expect(retryReadQuery(0, httpError(503))).toBe(true);
    expect(retryReadQuery(1, httpError(500))).toBe(false);
    expect(retryReadQuery(0, new Error("socket"))).toBe(true);
    expect(retryReadQuery(1, new Error("socket"))).toBe(false);
  });

  it("refreshes a successful read only", () => {
    expect(refetchWhenReadable("success")).toBe(true);
    expect(refetchWhenReadable("error")).toBe(false);
    expect(refetchWhenReadable("pending")).toBe(false);
  });

  it("starts login reads one after another", () => {
    expect(loginRequestGate({ sessionPending: true, hasSession: false, bootstrapSettled: false })).toEqual({
      bootstrap: false,
      brand: false,
    });
    expect(loginRequestGate({ sessionPending: false, hasSession: false, bootstrapSettled: false })).toEqual({
      bootstrap: true,
      brand: false,
    });
    expect(loginRequestGate({ sessionPending: false, hasSession: false, bootstrapSettled: true })).toEqual({
      bootstrap: true,
      brand: true,
    });
    expect(loginRequestGate({ sessionPending: false, hasSession: true, bootstrapSettled: true })).toEqual({
      bootstrap: false,
      brand: false,
    });
  });

  it("starts the dashboard mark and bell in separate seconds", () => {
    expect(dashboardFollowUp(false, 5_000)).toEqual({ brand: false, notifications: false });
    expect(dashboardFollowUp(true, 0)).toEqual({ brand: false, notifications: false });
    expect(dashboardFollowUp(true, 1_000)).toEqual({ brand: true, notifications: false });
    expect(dashboardFollowUp(true, 2_000)).toEqual({ brand: true, notifications: true });
  });

  it("leaves an icon in place when the next address is the one already loaded", () => {
    const base = "http://127.0.0.1:43173/login";
    const current = "http://127.0.0.1:43173/favicon.svg";
    expect(iconHrefNeedsUpdate(current, "/favicon.svg", base)).toBe(false);
    expect(iconHrefNeedsUpdate(current, "/api/v1/public/brand/favicon?v=1", base)).toBe(true);
  });
});
