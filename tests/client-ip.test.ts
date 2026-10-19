import { describe, expect, it } from "vitest";
import { rateLimitSubject } from "../server/http/client-ip";

function request(headers: Record<string, string>) {
  return new Request("http://127.0.0.1/api/v1/public/track/token", { headers });
}

describe("rate limit client identity", () => {
  it("ignores caller-supplied forwarding headers unless the Cloudflare trust flag is set", () => {
    const untrusted = {} as Env;
    expect(rateLimitSubject(request({ "x-forwarded-for": "1.2.3.4", "cf-connecting-ip": "8.8.8.8" }), untrusted)).toBe("direct-untrusted");
    const trusted = { TRUST_CF_CONNECTING_IP: "1" } as Env;
    expect(rateLimitSubject(request({ "cf-connecting-ip": "203.0.113.10", "x-forwarded-for": "1.2.3.4" }), trusted)).toBe("203.0.113.10");
    expect(rateLimitSubject(request({ "cf-connecting-ip": "203.0.113.10, 1.1.1.1" }), trusted)).toBe("direct-untrusted");
  });
});
