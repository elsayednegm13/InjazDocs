/** Who this project is, worked out fresh on every isolate wake.
 *
 * THE PROBLEM. Every other Boosthis kit answers "which install am I?" by
 * reading something it wrote down: a file under the home directory, browser
 * storage, a device keychain. An isolate has none of that. It also has no
 * memory between invocations, and a hundred of them can be alive at once. A
 * kit that minted a fresh identifier per wake would file one project as a
 * thousand, and the developer would watch their dashboard fill with strangers.
 *
 * THE ANSWER. Derive it. The install id is a hash of the project key plus a
 * slot name, so every wake of every isolate of that function computes the SAME
 * id without ever storing a byte. One project stays one project across any
 * number of wakes, restarts, region moves and redeploys.
 *
 *   installId = uuid-shaped(SHA-256("boosthis-edge-install-v1" | key | slot))
 *
 * The key is never sent and never recoverable from the id: it is a one-way
 * hash truncated to 128 bits, and the id is only ever an identifier anyway.
 *
 * THE SLOT. One project key can front several functions (an API worker and a
 * webhook worker, say). `slot` — the app name by default — is what separates
 * them, and it is the developer's own choice, so two functions that should be
 * one project can share a slot deliberately.
 */

const NAMESPACE = "boosthis-edge-install-v1";

/** Format 16 bytes as a version-5-shaped UUID (name-based, SHA-1 in the RFC;
 *  we use SHA-256 truncated, which is strictly stronger and shape-identical).
 *  The server only requires UUID shape, and a shaped id keeps the install id
 *  indistinguishable from every other kit's on the wire. */
function uuidFromBytes(bytes: Uint8Array): string {
  const b = bytes.slice(0, 16);
  b[6] = (b[6]! & 0x0f) | 0x50; // version 5 (name-based)
  b[8] = (b[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex: string[] = [];
  for (let i = 0; i < 16; i++) hex.push(b[i]!.toString(16).padStart(2, "0"));
  const s = hex.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

async function sha256(input: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(digest);
}

/** Is this string already a usable install id? A developer who pins one (an
 *  existing project they are moving onto an isolate) must keep it. */
export function looksLikeInstallId(value: string | undefined): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

/** Derive this function's install id. Deterministic: same key + same slot =
 *  same id, forever, on every isolate, with nothing written down. */
export async function deriveInstallId(
  projectKey: string,
  slot: string,
): Promise<string> {
  const bytes = await sha256(`${NAMESPACE}|${projectKey}|${slot}`);
  return uuidFromBytes(bytes);
}

/** Resolve the install id for this invocation: an explicitly pinned one wins,
 *  otherwise it is derived. */
export async function resolveInstallId(args: {
  projectKey: string;
  slot: string;
  pinned?: string | undefined;
}): Promise<string> {
  if (looksLikeInstallId(args.pinned)) return args.pinned.toLowerCase();
  return deriveInstallId(args.projectKey, args.slot);
}
