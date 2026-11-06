/** What this kit presents to prove it may upload — and why it is not a token.
 *
 * THE PROBLEM. Every other kit gets a delete token at registration and keeps
 * it: a file, browser storage, a keychain. An isolate has nowhere to keep one.
 * Worse, the server's recovery path for "I lost my token" hands back a FRESH
 * token and invalidates the old one. That is exactly right for a rebuilt phone
 * app and exactly wrong here: a hundred cold isolates all asking for their
 * credential back would each kill the other ninety-nine's, forever, at traffic
 * speed.
 *
 * THE ANSWER. In a place with no durable per-copy storage, the credential is
 * the project key the platform is already holding for us. It is the one secret
 * an isolate genuinely has (a Worker secret binding, a Deno environment
 * variable), it is scoped to exactly the projects it may write to, revoking it
 * stops every isolate at once, and nothing rotates so nothing thrashes.
 *
 * This is the settled model for stateless hosting, and it is deliberately the
 * same answer the Node serverless work needs: derive the identity, present the
 * key, keep nothing.
 */

import { readEnv } from "./platform";

/** The isolate-specific slot. One codebase often reports under more than one
 *  project — a Worker in front of a Node service is the common case — so this
 *  name outranks every other source, including the key passed in code, exactly
 *  as the per-runtime slot does in the other kits. */
export const RUNTIME_KEY_ENV_NAME = "BOOSTHIS_PROJECT_KEY_EDGE";

/** Environment names this kit reads, in the order it reads them. */
export const KEY_ENV_NAMES = [
  RUNTIME_KEY_ENV_NAME,
  "BOOSTHIS_KEY",
  "BOOSTHIS_PROJECT_KEY",
] as const;

export interface ResolvedKey {
  key: string | null;
  /** Where it came from, for the startup line. Never the key itself.
   *  "env-runtime" is the isolate's own slot, which beats a key in code. */
  source: "option" | "env" | "env-runtime" | "missing";
  /** Last four characters, so a developer can tell which key is loaded without
   *  the kit ever printing one. */
  tail: string | null;
}

export function resolveProjectKey(
  explicit: string | undefined,
  env?: Record<string, unknown> | undefined,
): ResolvedKey {
  // The isolate's own slot first, then the key passed in code, then the shared
  // names — the same ladder every other kit implements. A Worker sitting in
  // front of a Node service is one codebase reporting under two projects, and
  // the platform's setting is the only one the developer can change without
  // republishing the function.
  const runtimeSlot = readEnv(RUNTIME_KEY_ENV_NAME, env);
  if (runtimeSlot && runtimeSlot.trim()) {
    const key = runtimeSlot.trim();
    return { key, source: "env-runtime", tail: tailOf(key) };
  }
  const fromOption = typeof explicit === "string" ? explicit.trim() : "";
  if (fromOption) return { key: fromOption, source: "option", tail: tailOf(fromOption) };
  for (const name of KEY_ENV_NAMES) {
    if (name === RUNTIME_KEY_ENV_NAME) continue;
    const v = readEnv(name, env);
    if (v && v.trim()) {
      const key = v.trim();
      return { key, source: "env", tail: tailOf(key) };
    }
  }
  return { key: null, source: "missing", tail: null };
}

function tailOf(key: string): string {
  return key.length <= 4 ? key : key.slice(-4);
}
