/** Learning-loop WRITE client (dev-only, runs Node-side under the MCP server).
 *
 * Web parity of `lib/boosthis-runtime-node/src/proposeRule.ts` — see that file
 * for the full contract. When the developer's own AI reports a slow pattern that
 * no shipped rule covers (`boosthis.report_unmatched_pattern`), this module
 * forwards a privacy-safe PROPOSAL to the maintainer's review queue
 * (`POST /rules/propose`). The maintainer approves or rejects it by hand —
 * nothing here ever ships a rule.
 *
 * This module uses `node:crypto` and is therefore imported ONLY by the Node-side
 * MCP entrypoints (`mcp.ts` / `mcp-stdio.ts`), never re-exported from the
 * browser barrel (`index.ts`).
 *
 * TWO privacy tiers, decided by the SERVER:
 *   - TIER A (always): a demand signal only — runtime, a coarse category,
 *     severity + timing buckets, a NON-reversible sha256 of the pattern, and an
 *     occurrence count. No free text, no code, no identifiers.
 *   - TIER B (only when the app proves it has connected its AI): additionally
 *     the raw pattern text and any AI-drafted rule (id/title/whenToApply/fix).
 *     Proof is the install's read/web-read/delete token in the
 *     `X-Boosthis-Install-*` headers; the invite key alone never unlocks it.
 *
 * Delivery is `reportDelivery.ts` (lib/kit-report-delivery-contract.json): it
 * asks Boosthis whether the project is active, sends only then, waits for the
 * answer, and hands back what happened, so the tool's reply never says sent
 * for a report that was not. The payload rides the shared PII guard chokepoint
 * (`_gatedTransmitInternal`) and `BOOSTHIS_DISABLED` silences it. Nothing here
 * throws: a failure is an outcome with its reason, never a broken tool call.
 */

import { createHash } from "node:crypto";
import { checkNoPII } from "./no-pii";
import { deliverReport, type ReportOutcome } from "./reportDelivery";
import { SCORE_THRESHOLDS } from "./thresholds";

export type ProposalRuntime = "rn" | "node" | "py" | "web";
export type ProposalCategory =
  | "startup"
  | "navigation"
  | "interaction"
  | "rendering"
  | "network"
  | "data"
  | "memory"
  | "other";
type SeverityBucket = "low" | "med" | "high";
type TimingBucket = "good" | "warn" | "poor";

const CATEGORIES: ReadonlySet<string> = new Set<ProposalCategory>([
  "startup",
  "navigation",
  "interaction",
  "rendering",
  "network",
  "data",
  "memory",
  "other",
]);

function env(): Record<string, string | undefined> {
  return process.env;
}

function endpointBase(): string {
  const e = env();
  // `||` (not `??`) so a blank var never shadows the fallback — mirrors community.ts.
  const raw =
    e.BOOSTHIS_ENDPOINT ||
    e.BOOSTEN_ENDPOINT ||
    "https://www.boosthis.com/api";
  return raw.replace(/\/+$/, "");
}

function inviteKey(): string | undefined {
  const e = env();
  const k = (e.BOOSTHIS_PROJECT_KEY || e.BOOSTHIS_INVITE_KEY || e.BOOSTEN_INVITE_KEY || "").trim();
  return k || undefined;
}

/** Read/web-read/delete token that proves control of a connected install.
 *  Same env vars the stdio server uses to wire live-data reads. */
function installCreds(): { installId: string; token: string } | null {
  const e = env();
  const installId = (e.BOOSTHIS_INSTALL_ID || e.BOOSTEN_INSTALL_ID || "").trim();
  const token = (e.BOOSTHIS_READ_TOKEN || e.BOOSTEN_READ_TOKEN || "").trim();
  if (!installId || !token) return null;
  return { installId, token };
}

/** Map the tool's `language` enum to the wire `runtime` enum. */
export function runtimeFromLanguage(language: string): ProposalRuntime {
  switch (language) {
    case "node":
      return "node";
    case "python":
      return "py";
    case "react-native":
      return "rn";
    case "web":
      return "web";
    default:
      return "web";
  }
}

/** Non-reversible dedup + distinct-project counting key: sha256 of the
 *  whitespace-normalized, lower-cased pattern. The raw pattern is NEVER part
 *  of the tier-A signal — only this hash is. */
export function patternSignature(pattern: string): string {
  const norm = pattern.toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha256").update(norm).digest("hex");
}

/** Bucket the observed latency against the shared LCP thresholds (the web
 *  runtime's primary "how slow is this page" band — it has no TTI axis).
 *  Absent or non-finite input degrades to "warn" (an unmatched pattern is,
 *  by nature, a suspected problem). */
export function timingBucketFor(observedMs: number | undefined): TimingBucket {
  if (typeof observedMs !== "number" || !Number.isFinite(observedMs)) {
    return "warn";
  }
  const t = SCORE_THRESHOLDS.lcp;
  if (observedMs <= t.good) return "good";
  if (observedMs >= t.poor) return "poor";
  return "warn";
}

function severityFor(timing: TimingBucket): SeverityBucket {
  if (timing === "poor") return "high";
  if (timing === "warn") return "med";
  return "low";
}

function normalizeCategory(category: string | undefined): ProposalCategory {
  return category && CATEGORIES.has(category)
    ? (category as ProposalCategory)
    : "other";
}

/** Include a tier-B free-text field ONLY if it is present and passes the shared
 *  PII guard. Dropping a PII-tripping field (rather than aborting) keeps the
 *  tier-A demand signal alive while never sending PII-shaped free text — the
 *  server re-runs the same guard as the authority. */
function cleanText(
  value: string | undefined,
  maxLen: number,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.slice(0, maxLen);
  if (!trimmed) return undefined;
  return checkNoPII(trimmed) === null ? trimmed : undefined;
}

export interface UnmatchedPatternReport {
  pattern: string;
  language: string;
  observedMs?: number;
  category?: string;
  /** TIER B ONLY — an AI-drafted candidate rule. Sent only when install creds
   *  resolve; each field is independently PII-scanned and dropped if it trips. */
  draft?: {
    proposedRuleId?: string;
    title?: string;
    whenToApply?: string;
    fixTemplate?: string;
  };
}

/**
 * Send a rule PROPOSAL to the maintainer's review queue and say what happened.
 *
 * Never throws. No project key, `BOOSTHIS_DISABLED`, a locked project, or any
 * network, privacy-guard or transport failure comes back as an outcome that is
 * not sent, with its reason; `sent` is true only once Boosthis accepted it.
 */
export async function reportUnmatchedPattern(
  report: UnmatchedPatternReport,
): Promise<ReportOutcome> {
  const timingBucket = timingBucketFor(report.observedMs);
  const body: Record<string, unknown> = {
    runtime: runtimeFromLanguage(report.language),
    category: normalizeCategory(report.category),
    severityBucket: severityFor(timingBucket),
    timingBucket,
    signature: patternSignature(report.pattern),
    occurrences: 1,
  };

  // TIER B: only when we can prove control of a connected install. The
  // server still decides the tier — we just attach the proof + drafted text.
  let internalHeaders: Record<string, string> | undefined;
  const creds = installCreds();
  if (creds) {
    internalHeaders = {
      "X-Boosthis-Install-Id": creds.installId,
      "X-Boosthis-Install-Token": creds.token,
    };
    const rawPattern = cleanText(report.pattern, 2000);
    if (rawPattern) body.pattern = rawPattern;
    const d = report.draft ?? {};
    if (d.proposedRuleId) {
      const id = d.proposedRuleId.slice(0, 80);
      if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) body.proposedRuleId = id;
    }
    const title = cleanText(d.title, 160);
    if (title) body.title = title;
    const whenToApply = cleanText(d.whenToApply, 2000);
    if (whenToApply) body.whenToApply = whenToApply;
    const fixTemplate = cleanText(d.fixTemplate, 8000);
    if (fixTemplate) body.fixTemplate = fixTemplate;
  }

  // A proposal requires a project key (the distributable `fix` scope); without
  // one nothing leaves, and the outcome says so.
  return deliverReport({ endpoint: endpointBase(), key: inviteKey(), body, internalHeaders });
}

// ── A CRASH-FIX REPORT, through the same channel ─────────────────────────────
// After fixing a crash Boosthis recorded, the developer's assistant can hand
// back what worked: the crash, by reference (the identity the crash read
// handed out — never pasted text), a closed fix-shape word, and whether a
// Boosthis rule helped. It rides `/rules/propose` like every proposal: the
// same project key, the same tier proof, the same server screen. A person
// reviews it; nothing is read back.

/** The crash-cause mechanism words a fix can name. The server's closed list
 *  (CRASH_FIX_SHAPES); a server-side parity test pins this copy to it. */
export const CRASH_FIX_SHAPES = [
  "missing-value-field",
  "not-a-list",
  "malformed-data",
  "index-out-of-range",
  "out-of-memory",
  "timed-out",
  "unclassified",
] as const;

/** The fixer's own verdict. `none`: no Boosthis rule was used. */
export const CRASH_RULE_HELPED = ["yes", "no", "none"] as const;

const CRASH_REF_RE = /^[A-Za-z0-9][A-Za-z0-9:._-]*$/;
const RULE_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface CrashFixReport {
  crash: string;
  fixShape: string;
  ruleHelped: string;
  ruleId?: string;
  /** TIER B ONLY — sent only when install creds resolve. */
  words?: { title?: string; whenToApply?: string; fixTemplate?: string };
}

/** Why a report cannot be filed, in words naming every accepted value — or
 *  null when it can. Checked before anything is sent. */
export function crashFixRefusal(r: {
  crash: unknown;
  fixShape: unknown;
  ruleHelped: unknown;
  ruleId?: unknown;
}): string | null {
  if (typeof r.crash !== "string" || r.crash.length > 128 || !CRASH_REF_RE.test(r.crash)) {
    return "crash must be a crash identity exactly as the crash read gave it";
  }
  if (typeof r.fixShape !== "string" || !(CRASH_FIX_SHAPES as readonly string[]).includes(r.fixShape)) {
    return `fix_shape must be one of: ${CRASH_FIX_SHAPES.join(", ")}`;
  }
  if (typeof r.ruleHelped !== "string" || !(CRASH_RULE_HELPED as readonly string[]).includes(r.ruleHelped)) {
    return `rule_helped must be one of: ${CRASH_RULE_HELPED.join(", ")} (none: no Boosthis rule was used)`;
  }
  if (
    r.ruleId !== undefined &&
    (typeof r.ruleId !== "string" || r.ruleId.length > 80 || !RULE_ID_RE.test(r.ruleId))
  ) {
    return "rule_id must be a Boosthis rule id (lower-case words joined by hyphens)";
  }
  return null;
}

/**
 * Send a crash-fix report and say what happened, exactly like
 * {@link reportUnmatchedPattern}. A report whose words the kit itself refuses
 * (the tool checks them first and names every accepted value) never leaves.
 */
export async function reportCrashFix(report: CrashFixReport): Promise<ReportOutcome> {
  if (crashFixRefusal(report) !== null) return { sent: false, reason: "refused" };
  // The channel's own envelope. The server places a report by the crash it
  // names, never by these; they are present because the shared body
  // requires them, and `signature` is a hash, so the reference is not
  // repeated in readable form.
  const body: Record<string, unknown> = {
    runtime: "web",
    category: "other",
    severityBucket: "low",
    timingBucket: "good",
    signature: patternSignature(`crash-fix:${report.crash}`),
    occurrences: 1,
    crashRef: report.crash,
    fixShape: report.fixShape,
    ruleHelped: report.ruleHelped,
  };
  if (report.ruleId) body.ruleId = report.ruleId;
  let internalHeaders: Record<string, string> | undefined;
  const creds = installCreds();
  if (creds) {
    internalHeaders = {
      "X-Boosthis-Install-Id": creds.installId,
      "X-Boosthis-Install-Token": creds.token,
    };
    const w = report.words ?? {};
    const title = cleanText(w.title, 160);
    if (title) body.title = title;
    const whenToApply = cleanText(w.whenToApply, 2000);
    if (whenToApply) body.whenToApply = whenToApply;
    const fixTemplate = cleanText(w.fixTemplate, 8000);
    if (fixTemplate) body.fixTemplate = fixTemplate;
  }
  return deliverReport({ endpoint: endpointBase(), key: inviteKey(), body, internalHeaders });
}
