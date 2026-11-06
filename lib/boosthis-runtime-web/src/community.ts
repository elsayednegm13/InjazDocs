/** Community rule book client (dev-only, runs Node-side under the MCP server).
 *
 * Reads a privacy-safe AGGREGATE of fixes proven across ALL projects from the
 * public `GET /rules/community` endpoint and holds it in memory so the matcher
 * can recommend real-world-proven fixes without a network round-trip on the hot
 * path. This is the read side of Boosthis's global self-learning loop.
 *
 * It is strictly read-only and fail-open: it only GETs the public aggregate
 * (rule ids + buckets + counts — no code, no route names, no values, no
 * installId), and ANY error (offline, missing cache, bad JSON, rate limited)
 * silently yields an empty book so the matcher falls back to its static
 * ranking. Nothing here ever transmits OUT.
 *
 * NOTE (web runtime): this module is imported ONLY by the Node-side MCP
 * entrypoint (`mcp-stdio.ts`), never by browser code — it uses node:fs/os/path
 * only to remove a disk cache left by an older release.
 */

import { answerRefusal, readAnswerJson, readAnswerText } from "./answerRead";
import { endpointBase, inviteKey } from "./lookupEndpoint";
import { unwatchedFetch } from "./callWatch";
import { unlinkSync } from "node:fs";
import { registerToolHolder, toolLocked, toolGeneration, learnToolRefusal, RULE_LOCK_REFUSAL } from "./toolLock";
import { homedir } from "node:os";
import { join } from "node:path";
import { kitTimeout } from "./zoneSafe";
import { checkNoPIIInUrl } from "./no-pii";
import {
  refusalAnswer,
  refusalBodyMatters,
  refusalNote,
  type HeldReason,
  type Refusal,
  type RetiredBecause,
} from "./ruleLookup";

export interface CommunityEntry {
  projects: number;
  evidence: number;
  circumstances: string[];
}

interface CommunityRuleRow {
  ruleId?: string;
  severityBucket?: string | null;
  countBucket?: string | null;
  projects?: number;
  evidence?: number;
}

const TTL_MS = 6 * 60 * 60 * 1000;
let refreshing = false;
const books = new Map<string, { at: number; rules: CommunityRuleRow[] }>();
registerToolHolder(() => books.clear());
function removeLegacyBook(runtime: string): void {
  try { unlinkSync(cacheFile(runtime)); } catch { /* absent or inaccessible */ }
}

/** Ceilings on the two answers this module reads, enforced while reading. */
const FIX_ANSWER_MAX_BYTES = 100_000;
const BOOK_ANSWER_MAX_BYTES = 1_000_000;

function env(): Record<string, string | undefined> {
  return process.env;
}

function cacheFile(runtime: string): string {
  return join(homedir(), ".boosthis", `community.${runtime}.json`);
}

function describe(sev?: string | null, ct?: string | null): string {
  const s = sev ? `${sev} severity` : "any severity";
  const c = ct ? `${ct} occurrences` : "any volume";
  return `${s} · ${c}`;
}

/** Synchronously read the cached community book, rolled up per ruleId. Returns
 *  an empty map on any failure (the matcher then uses static ranking only). */
export function readCommunityCache(runtime: string): Map<string, CommunityEntry> {
  removeLegacyBook(runtime);
  const out = new Map<string, CommunityEntry>();
  if (toolLocked()) return out;
  try {
    const data = books.get(runtime);
    for (const r of data?.rules ?? []) {
      if (!r || typeof r.ruleId !== "string") continue;
      const cur = out.get(r.ruleId) ?? {
        projects: 0,
        evidence: 0,
        circumstances: [],
      };
      // projects is a distinct-project count PER circumstance row, so the
      // strongest single circumstance is the honest per-rule confidence;
      // evidence accumulates across circumstances.
      cur.projects = Math.max(cur.projects, r.projects ?? 0);
      cur.evidence += r.evidence ?? 0;
      const desc = describe(r.severityBucket, r.countBucket);
      if (!cur.circumstances.includes(desc)) cur.circumstances.push(desc);
      out.set(r.ruleId, cur);
    }
  } catch {
    // fail open
  }
  return out;
}

/** Kick off a best-effort cache refresh if the cache is missing or stale.
 *  Fire-and-forget: never awaited, never throws. Skipped under test so unit
 *  tests stay hermetic and never touch the network. */
export function refreshCommunityCacheIfStale(runtime: string): void {
  const e = env();
  if (e.VITEST || e.NODE_ENV === "test" || e.BOOSTHIS_DISABLED) return;
  if (refreshing) return;
  removeLegacyBook(runtime);
  if (toolLocked()) return;
  if (Date.now() - (books.get(runtime)?.at ?? 0) < TTL_MS) return;
  refreshing = true;
  void fetchAndWrite(runtime).finally(() => {
    refreshing = false;
  });
}

/** Result of fetching ONE rule's prescriptive fix from the server. The fix
 *  text is deliberately NOT bundled in this package, so it is fetched per-rule
 *  and fails GRACEFULLY: detection (when_to_apply) always works offline; only
 *  the written fix needs an invited app + a connection. */
export interface RuleFixResult {
  fix_available: boolean;
  fix_template?: string;
  fix_note?: string;
  community_proven?: boolean;
  community_projects?: number;
  community_evidence?: number;
  /** Covered same-concept siblings of this rule in OTHER languages, served by
   *  the server from its coverage map. Only rules that actually exist are
   *  ever listed (never gaps or "can't happen here" notes). */
  counterparts?: { runtime: string; rule_id: string; concept: string }[];
  /** Only when the fix address said more than "no": the rule was retired (and
   *  what replaced it), or the copy lock held the fix back (and why). The
   *  sentence rides fix_note, and is the one the lookup carries. */
  fix_lookup?: "retired" | "held";
  retired_because?: RetiredBecause | null;
  retired_says?: string | null;
  replaced_by?: string | null;
  held_reason?: HeldReason;
  held_says?: string | null;
}

/** The fix fields for a retired rule or a held fix, never a retry. */
function refusalFix(refusal: Refusal): RuleFixResult {
  if (refusal.kind === "retired") {
    return {
      fix_available: false,
      fix_lookup: "retired",
      retired_because: refusal.retired_because,
      retired_says: refusal.retired_says,
      replaced_by: refusal.replaced_by,
      fix_note: refusalNote(refusal),
    };
  }
  return {
    fix_available: false,
    fix_lookup: "held",
    held_reason: refusal.held_reason,
    held_says: refusal.held_says,
    fix_note: refusalNote(refusal),
  };
}

/** Validate the server's counterparts list into the closed snake_case wire
 *  shape. Untrusted input: anything malformed is dropped, strings are capped,
 *  and at most 5 entries survive (one per other language). */
function sanitizeCounterparts(
  raw: unknown,
): { runtime: string; rule_id: string; concept: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { runtime: string; rule_id: string; concept: string }[] = [];
  for (const item of raw) {
    if (out.length >= 5) break;
    if (typeof item !== "object" || item === null) continue;
    const c = item as Record<string, unknown>;
    if (
      typeof c["runtime"] === "string" &&
      typeof c["ruleId"] === "string" &&
      typeof c["concept"] === "string"
    ) {
      out.push({
        runtime: c["runtime"].slice(0, 10),
        rule_id: c["ruleId"].slice(0, 100),
        concept: c["concept"].slice(0, 200),
      });
    }
  }
  return out;
}

/** A fix request the kit's own privacy check stopped on this device. Boosthis
 *  never saw it, so the note never says the server refused it. */
const BLOCKED_ON_DEVICE_NOTE =
  "The kit's own privacy check stopped this fix request on this device: its " +
  "address carried something shaped like personal data, so nothing was sent.";

const NO_KEY_NOTE =
  "Fix guidance is served per-rule from the Boosthis server and requires a " +
  "registered (invited) app. Set BOOSTHIS_PROJECT_KEY in this MCP server's " +
  "environment to receive the fix. Detection (when_to_apply) works fully " +
  "offline without it.";

/** Fetch a single rule's fix from `GET /rules/fix` (invite-key bearer auth).
 *  Never throws — on any failure it returns `fix_available: false` with a note
 *  the agent can act on. The corpus is never fetched in bulk. */
export async function fetchRuleFix(
  ruleId: string,
  runtime: "js" | "py" | "web",
): Promise<RuleFixResult> {
  if (toolLocked()) return { fix_available: false, fix_note: RULE_LOCK_REFUSAL };
  const epoch = toolGeneration();
  const key = inviteKey();
  if (!key) return { fix_available: false, fix_note: NO_KEY_NOTE };
  try {
    const url = `${endpointBase()}/rules/fix?ruleId=${encodeURIComponent(
      ruleId,
    )}&runtime=${encodeURIComponent(runtime)}`;
    // The kit's own address check, before anything is sent.
    if (checkNoPIIInUrl(url)) return { fix_available: false, fix_note: BLOCKED_ON_DEVICE_NOTE };
    const controller = new AbortController();
    const timer = kitTimeout(() => controller.abort(), 5000);
    try {
      const res = await (unwatchedFetch() ?? fetch)(url, {
        method: "GET",
        headers: { accept: "application/json", authorization: `Bearer ${key}` },
        signal: controller.signal,
      });
      await learnToolRefusal(res, () => (unwatchedFetch() ?? fetch)(url, {
        headers: { accept: "application/json", authorization: `Bearer ${key}` },
      }));
      if (toolLocked()) return { fix_available: false, fix_note: RULE_LOCK_REFUSAL };
      // A retired rule (410) and a fix the copy lock held back are told apart
      // by the body Boosthis sends with them, read under the answer's own
      // ceiling. Neither is "no fix" and neither is worth a retry.
      if (!res.ok && refusalBodyMatters(res.status)) {
        let body: unknown = undefined;
        try {
          body = await readAnswerJson(res, { maxBytes: FIX_ANSWER_MAX_BYTES, timeoutMs: 5000 });
        } catch {
          body = undefined;
        }
        if (epoch !== toolGeneration() || toolLocked()) return { fix_available: false, fix_note: RULE_LOCK_REFUSAL };
        const refusal = refusalAnswer(res.status, body);
        if (refusal) return refusalFix(refusal);
      }
      if (res.status === 401 || res.status === 403) {
        return {
          fix_available: false,
          fix_note:
            `The Boosthis server rejected this project key (${res.status}). Check ` +
            "BOOSTHIS_PROJECT_KEY.",
        };
      }
      if (res.status === 404) {
        return {
          fix_available: false,
          fix_note: `The server has no fix for rule '${ruleId}'.`,
        };
      }
      if (res.status === 429) {
        return {
          fix_available: false,
          fix_note: "Fix endpoint is rate limited right now; retry shortly.",
        };
      }
      if (!res.ok) {
        // Only a failure on Boosthis's side is worth asking again; any other
        // refusal will be refused the same way next time.
        return {
          fix_available: false,
          fix_note:
            res.status >= 500
              ? `The Boosthis server failed to answer (status ${res.status}); the fix can be asked for again later.`
              : `The Boosthis server refused this fix request (status ${res.status}).`,
        };
      }
      // Bounded while reading. A refused answer says which way it failed, in
      // the kit's own words; it is never "could not reach", because the
      // server was reached.
      let data: {
        fixTemplate?: string;
        community?: { projects?: number; evidence?: number } | null;
        counterparts?: unknown;
      } | null;
      try {
        data = (await readAnswerJson(res, {
          maxBytes: FIX_ANSWER_MAX_BYTES,
          timeoutMs: 5000,
        })) as typeof data;
      } catch (err) {
        const refusal = answerRefusal(err);
        if (refusal === "too-large") {
          return { fix_available: false, fix_note: "Unexpected oversized fix response." };
        }
        if (refusal === "too-slow") {
          return {
            fix_available: false,
            fix_note: "The fix response did not finish arriving in time; retry shortly.",
          };
        }
        if (refusal === "malformed") {
          return { fix_available: false, fix_note: "Malformed fix response." };
        }
        throw err;
      }
      if (epoch !== toolGeneration() || toolLocked()) return { fix_available: false, fix_note: RULE_LOCK_REFUSAL };
      if (!data || typeof data.fixTemplate !== "string") {
        return { fix_available: false, fix_note: "Malformed fix response." };
      }
      const out: RuleFixResult = {
        fix_available: true,
        fix_template: data.fixTemplate,
      };
      if (
        data.community &&
        typeof data.community.projects === "number" &&
        data.community.projects > 0
      ) {
        out.community_proven = true;
        out.community_projects = data.community.projects;
        out.community_evidence =
          typeof data.community.evidence === "number" ? data.community.evidence : 0;
      }
      const counterparts = sanitizeCounterparts(data.counterparts);
      if (counterparts.length > 0) out.counterparts = counterparts;
      return out;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return {
      fix_available: false,
      fix_note:
        "Could not reach the Boosthis server (offline?). Detection still " +
        "works offline; fetch the fix when back online.",
    };
  }
}

async function fetchAndWrite(runtime: string): Promise<void> {
  const epoch = toolGeneration();
  try {
    const url = `${endpointBase()}/rules/community?runtime=${encodeURIComponent(runtime)}`;
    // The kit's own address check, before anything is sent. A refused address
    // sends nothing and keeps the last good copy, like any refusal.
    if (checkNoPIIInUrl(url)) return;
    // The community book is now invite-gated (registered apps only). Present the
    // same invite key used for fix fetches when one is configured; without it the
    // server returns 403; a project-lock refusal drops the in-memory book.
    const key = inviteKey();
    const headers: Record<string, string> = { accept: "application/json" };
    if (key) headers.authorization = `Bearer ${key}`;
    const controller = new AbortController();
    const timer = kitTimeout(() => controller.abort(), 5000);
    let body: string;
    try {
      const res = await (unwatchedFetch() ?? fetch)(url, {
        method: "GET",
        headers,
        signal: controller.signal,
      });
      await learnToolRefusal(res, () => (unwatchedFetch() ?? fetch)(url, { headers }));
      if (!res.ok || toolLocked()) return;
      // Bounded while reading: an oversized or slow book is refused before it
      // is held, and an ordinary outage keeps only the in-memory copy.
      body = await readAnswerText(res, {
        maxBytes: BOOK_ANSWER_MAX_BYTES,
        timeoutMs: 5000,
      });
    } finally {
      clearTimeout(timer);
    }
    const parsed = JSON.parse(body) as { rules?: CommunityRuleRow[] };
    if (epoch !== toolGeneration() || toolLocked()) return;
    books.set(runtime, { at: Date.now(), rules: parsed.rules ?? [] });
  } catch {
    // offline / abort / bad JSON → keep last good cache
  }
}
