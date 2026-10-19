/**
 * Client identity for rate limits.
 *
 * X-Forwarded-For is never trusted: the caller can set it.
 * CF-Connecting-IP is trusted only when TRUST_CF_CONNECTING_IP=1, which must
 * be set solely on a Worker reached through Cloudflare's proxy (the edge
 * overwrites that header). Local wrangler and any direct Worker URL leave the
 * flag unset, so every caller shares one bucket and cannot rotate a spoofed IP
 * to reset the counter. A global Cloudflare WAF limit is still a production gate.
 */
export function rateLimitSubject(request: Request, env: Env): string {
  if (env.TRUST_CF_CONNECTING_IP === "1") {
    const raw = request.headers.get("cf-connecting-ip")?.trim() ?? "";
    if (raw && !/[\s,]/.test(raw)) return raw;
  }
  return "direct-untrusted";
}
