/**
 * Where the kit's AI connection asks Boosthis, and the project key it presents
 * there. Both the rule lookup and the community client read these, and the
 * community client's fix fetch reads the lookup's retired and held answers
 * back, so these live in a module that imports nothing: neither of the two
 * may import the other for them (lib/kit-module-cycles.json).
 */

function env(): Record<string, string | undefined> {
  return process.env;
}

export function endpointBase(): string {
  const e = env();
  // `||` (not `??`) so a blank var never shadows the fallback. Live default
  // points at the maintainer's server; override with BOOSTHIS_ENDPOINT.
  const raw =
    e.BOOSTHIS_ENDPOINT ||
    e.BOOSTEN_ENDPOINT ||
    "https://www.boosthis.com/api";
  return raw.replace(/\/+$/, "");
}

/** The single invite key this MCP server may present to the fix endpoint. The
 *  developer sets it once in the MCP server's environment (the same invite key
 *  they registered telemetry with). `||` (not `??`) so a blank var falls
 *  through. The invite key — not a per-install token — is the uniform
 *  credential so the same flow works for RN, Node, Python, and web. */
export function inviteKey(): string | undefined {
  const e = env();
  return e.BOOSTHIS_PROJECT_KEY || e.BOOSTHIS_INVITE_KEY || e.BOOSTEN_INVITE_KEY || undefined;
}
