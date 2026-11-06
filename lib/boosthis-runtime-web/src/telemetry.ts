/** Opt-in telemetry client for the web runtime.
 *
 * Faithful (reduced-scope) port of `lib/boosthis-runtime-node/src/telemetry.ts`.
 * `enableTelemetry` registers an invited web app with the central Boosthis
 * server so it appears in the maintainer's /admin dashboard, then reports:
 *
 *   - optional full per-page samples: only in full-telemetry mode, stopped by
 *     `disable()` / `issuesOnly`;
 *   - the PII-filtered perf SNAPSHOT mirror: off in issues-only mode unless
 *     the developer opted in via `shareMeterWithAI` OR the server directive
 *     fired ("Connect AI" pressed in the web dashboard);
 *   - privacy-safe trace SPANS: ride the exact same allow-gate as the snapshot
 *     mirror (code-defined route labels only), off on a private app until
 *     sharing is authorized;
 *   - always-on CRASH reports (for registered apps): a separate channel that
 *     installs once from `enableTelemetry` and reports on its own — only the
 *     kill-switch or `forget()` can stop it;
 *   - always-on recurring-PROBLEM reports and fix outcomes (candidates +
 *     resolutions): the same always-on gate as crashes, fed from the kit's own
 *     live readings by `./reporting` and accumulated by `./candidateRules`.
 *     Nothing on this channel carries a page label — only a hashed
 *     `<kind>:<severityBucket>:<countBucket>` signature and an occurrence
 *     count.
 *
 * The kill-switch (`BOOSTHIS_DISABLED` / `globalThis.__BOOSTHIS_DISABLED__`)
 * and `forget()` behave exactly like the other runtimes.
 */

import { pageEnvironmentNow, developmentInstallIdFor } from "./developmentPage";
import { resetPressToScreen } from "./pressToScreen";
import { keepCrash, keepCaught, offerCrashes, type CrashBatch } from "./crashDelivery";
import { unwatchedFetch } from "./callWatch";
import { configurePageCallTrace, resetPageCallTrace } from "./pageCallTrace";
import type { ProblemCause } from "./problemCause";
import { readAnswerJson } from "./answerRead";
import { noteOwnEndpoint } from "./edgeCache";
import { assertNoPII, checkNoPII, transmitLabelHasPII, PIIDetectedError } from "./no-pii";
import {
  MAX_PART_NAME,
  normalizeRouteLabel,
  warnPartNameRefusal,
} from "./vitals";
import { isControlHandle } from "./controlHandle";
// The page map's SENDING boundary — labels and pairs of labels, nothing else,
// and only when the host opted in. `pageMap.ts` (the recorder) is not
// imported here on purpose: this file can only reach what that module is
// willing to hand out for the wire.
import { buildPageMapWire } from "./pageMapWire";
import {
  _safeTransmitTrustedPayload,
  isNoSendResponse,
  type InternalPostOptions,
} from "./transmit";
// EVERY upload goes through the end-user-permission door, never straight at
// the transport. See gatedSend.ts; a test fails the build if this file
// reaches for _safeTransmitInternal again.
import { _gatedTransmitInternal } from "./gatedSend";
import { RUNTIME_VERSION, type Rating } from "./thresholds";
import { declaredAppVersionBlock } from "./appVersionFacts";
import { isBoosthisDisabled } from "./runtimeFlags";
import { setSampleObserver, type Sample } from "./samples";
import {
  PAGE_LOAD_TIMINGS,
  PAGE_OPENED_WORDS,
  type PageLoadTiming,
  type PageOpened,
} from "./pageLoadTiming";
import {
  plannedSnapshotIntervalMs,
  setSnapshotSubmitter,
  startSnapshotAutoUpload,
  stopSnapshotAutoUpload,
  uploadPerfSnapshotNow,
  type WebSnapshotPayload,
} from "./snapshot";
import {
  setSpanSubmitter,
  startSpanAutoFlush,
  stopSpanAutoFlush,
  clearBufferedSpans,
  holdSpanBatch,
  MAX_SPAN_BATCH,
  type TraceSpan,
} from "./spanEmitter";
import { resetRouteOutcomes } from "./routeOutcomes";
import { uninstallLocalStoreTracking } from "./localStore";
import {
  installCrashHandlers,
  setCrashSubmitter,
  uninstallCrashHandlers,
  type CrashReportPayload,
} from "./crashReporter";
import {
  setCandidateSubmitter,
  setResolutionSubmitter,
  clearAllCandidates,
  type CandidateUploadResult,
} from "./candidateRules";
import { startReporting, stopReporting } from "./reporting";
import { clearPageViewTally } from "./pageViewTally";
import { clearDeviceStorage, storage } from "./storage";
import { clearVisitTag } from "./visitTag";
import {
  _onEndUserConsentChange,
  maySendToServer,
  resolveStartConsent,
  setEndUserConsent,
  type EndUserConsent,
} from "./endUserConsent";
import {
  forgetRegistered,
  rememberRegistered,
  wasRegisteredBefore,
} from "./registrationMemory";
import {
  startEntitlementCheckin,
  stopEntitlementCheckin,
  clearEntitlementCache,
  chaseFirstActivation,
  ensureEntitlementChecked,
  subscribeEntitlement,
  hasBeenActiveThisRun,
  isRuntimeInert,
  isDissolvedThisRun,
  registerLockLifecycle,
  restartingDissolved,
  claimRestartRegistration,
} from "./killSwitch";
import { clearSettle } from "./settle";
import {
  describeProjectKeySource,
  resolveProjectKey,
  type ResolvedProjectKey,
} from "./projectKey";
import { announceProjectKey } from "./startAnnounce";
import {
  getKitProject,
  parseKitProject,
  serializeKitProject,
  setKitProject,
} from "./projectIdentity";
import {
  checkRegistrationOnce,
  markRegistrationConfirmed,
  markRegistrationRefused,
  markRegistrationThrottled,
  markRegistrationUnreachable,
} from "./registration";
import {
  bindPaceInstall,
  claimSend,
  clearUploadPace,
  handOverSamples,
  handedOverCount,
  isLocalPauseAnswer,
  lastSentAt,
  mayHandOver,
  noteHeldDropped,
  holdForStatedWait,
  noteSent,
  recordSnapshotHint,
  recordVisitShare,
  pausedUntil,
  retryAfterOf,
  returnSamples,
  snapshotHintAt,
  takeHandedOverSamples,
  unnoteSent,
  visitMeasured,
  whenPauseEnds,
  type PaceKind,
} from "./uploadPacing";
import {
  getRegistrationRefusalKind,
  getRegistrationRefusalSentence,
  registrationFailureHint,
  setRegistrationRefusalKind,
  warnStayedInactiveOnce,
  _resetInactiveNoticeForTests,
  type RegistrationFailure,
} from "./inactiveNotice";
import {
  setRegistrationProbe,
  noteRegistrationAttemptEnded,
  noteRegistrationAttemptStarted,
  noteRegistrationConfirmed,
  noteRegistrationExplained,
  noteRegistrationNotSent,
  noteRegistrationTrouble,
} from "./registrationWatch";
import {
  isCredentialMismatch,
  noteUploadRefusedOnce,
  readCredentialRefusal,
  type RefusalBody,
} from "./uploadRefusal";
import { kitMicrotask, kitTimeout, outsideAngular } from "./zoneSafe";
import { inServerRender } from "./browserPage";
import { retryWaitMs } from "./retrySchedule";

// The inactive-line wording and the refusal it describes now live in their own
// module, because the failures that produce the WORST silence happen outside
// any registration round trip (see registrationWatch.ts). They stay exported
// from here so every existing caller — the barrel, the panel, the status
// readout — keeps reading them from one place.
export {
  getRegistrationRefusalKind,
  getRegistrationRefusalSentence,
} from "./inactiveNotice";

export const DEFAULT_TELEMETRY_ENDPOINT = "https://www.boosthis.com/api";

/** The most recently created telemetry client for this page, or null before
 *  `enableTelemetry` has run. Held so display-only surfaces (the bubble's
 *  dashboard panel + its account card) can read the live endpoint / installId /
 *  read+delete tokens WITHOUT the host having to thread the client through.
 *  Mirror of the RN kit's `getActiveTelemetryClient()`. */
let activeClient: TelemetryClient | null = null;
let activeProjectKey: ResolvedProjectKey = {
  key: null,
  source: "none",
  overrodeShared: false,
  display: null,
  declined: false,
};

export function getActiveProjectKey(): ResolvedProjectKey {
  return activeProjectKey;
}

export function getActiveProjectKeyStatus(): {
  display: string | null;
  description: string;
} {
  return {
    display: activeProjectKey.display,
    description: describeProjectKeySource(activeProjectKey.source),
  };
}

/** The active telemetry client, or null if `enableTelemetry` has not run.
 *  Read-only accessor for display-only surfaces (never mutated by callers). */
export function getActiveTelemetryClient(): TelemetryClient | null {
  return activeClient;
}

/** Whether THIS page asked for its page map to be uploaded (`sendPageMap`).
 *  False until enableTelemetry() runs, and false for every site that never
 *  asked — the default. Read by the bubble so its page-map row says where the
 *  map goes; it reports the host's request, not that an upload happened
 *  (consent, the kill switch, entitlement and issues-only all still decide
 *  that). */
let pageMapSendRequested = false;
/**
 * Apply the dashboard "Full telemetry" directive to the active telemetry client
 * IN-SESSION, using the SAME directive-apply path the consent response uses
 * (`serverFullTelemetry` → sample firehose + snapshot mirror re-wire). The
 * bubble's account card calls this right after its own successful telemetry-
 * toggle POST so the new mode takes effect immediately with no relaunch and no
 * code change. A no-op (returns false) when telemetry was never enabled. Never
 * throws: it delegates to the client method, whose gates already honor
 * disable()/forget()/BOOSTHIS_DISABLED.
 */
export function applyServerFullTelemetry(on: boolean): boolean {
  try {
    const client = activeClient;
    if (!client) return false;
    client.applyServerFullTelemetry(on);
    return true;
  } catch {
    return false;
  }
}

/** Web analogue of RN's `resolveDashboardWebUrl` — the human-facing dashboard
 *  origin derived from the active endpoint (…/api → origin). Falls back to the
 *  default origin when no client is active. Never throws. */
export function resolveDashboardWebUrl(): string {
  try {
    const ep = activeClient?.endpoint ?? DEFAULT_TELEMETRY_ENDPOINT;
    return ep.replace(/\/api\/?$/, "").replace(/\/+$/, "");
  } catch {
    return DEFAULT_TELEMETRY_ENDPOINT.replace(/\/api\/?$/, "");
  }
}

/** @internal test hook — clear the active-client registry between runs. */
export function _resetActiveTelemetryClientForTests(): void {
  activeClient = null;
  pageMapSendRequested = false;
  resetPageCallTrace();
  activeProjectKey = {
    key: null,
    source: "none",
    overrodeShared: false,
    display: null,
    declined: false,
  };
  _resetInactiveNoticeForTests();
}

let warnedProjectKeyOverride = false;

/** Sticky "registration rejected — the install ID is not a UUID" state. Set
 *  ONLY by the server's fixed `invalid_install_id` marker on a 400 consent
 *  response (the server validates `install_id` as a UUID v4). Before this the
 *  case looked exactly like a healthy install to the developer — consent
 *  returned, nothing threw, and the bubble kept saying "awaiting telemetry"
 *  forever. Read by the bubble so the panel shows the rejected state instead
 *  of a normal/awaiting one. Module-level (like the warn guard) so display-only
 *  surfaces can read it without the host threading the client through. */
let installIdRejected = false;

/** Whether the server rejected this app's install ID for not being a UUID.
 *  Display-only read for the bubble; never carries any server text. */
export function isInstallIdRejected(): boolean {
  return installIdRejected;
}

/** One-shot guard so the invalid-install-id rejection prints exactly ONE line
 *  per page — never once per consent attempt. */
let warnedInstallIdRejected = false;

/** Handle a 400 consent response. Returns true when the body carried the
 *  server's FIXED `invalid_install_id` marker — in which case the kit records
 *  the rejected state and prints one code-defined line. It never echoes the
 *  server's text, the install id, or any request/response value, and it never
 *  schedules the hourly rejected-registration retry: re-sending an unchanged
 *  bad id can never succeed, so that loop stays reserved for 401/403 key
 *  rejection. Never throws into the host. */
async function handleInvalidInstallIdOnce(res: Response): Promise<boolean> {
  let invalid = false;
  try {
    // A copy, bounded while reading: the caller may still read the original.
    const body = (await readAnswerJson(res.clone())) as { error?: unknown } | null;
    invalid = body?.error === "invalid_install_id";
  } catch {
    // Non-JSON / unreadable body — treat as an ordinary 400, not this case.
    invalid = false;
  }
  if (!invalid) return false;
  installIdRejected = true;
  if (warnedInstallIdRejected) return true;
  warnedInstallIdRejected = true;
  try {
    console.warn(
      "[boosthis] Registration rejected: this app's Boosthis install ID is " +
        "not a valid UUID. Generate a real UUID (e.g. uuidgen / " +
        "crypto.randomUUID()), persist it as the install ID, then restart.",
    );
  } catch {
    // A host that replaced console must never crash because of a warning.
  }
  return true;
}

/** Test-only: reset the one-shot registration-warning guards + the sticky
 *  invalid-install-id rejected state. */
export function _resetRegistrationWarningForTests(): void {
  warnedInstallIdRejected = false;
  installIdRejected = false;
  warnedProjectKeyOverride = false;
  _resetInactiveNoticeForTests();
}

// ── "The server stored fewer rows than we sent" ─────────────────────────────
//
// WHY THIS EXISTS. The upload endpoints answer 202 and then discard individual
// rows they cannot store: a route label the privacy guard refuses, a span past
// the per-trace cap, a snapshot entry whose name is rejected. Until now the kit
// read that 202 as unqualified success, so a developer whose every route label
// was being thrown away saw a healthy page, no output, and a dashboard quietly
// missing data. This reads the reply's honesty fields and warns ONCE per cause,
// reusing the same latch style + stream + crash-safety as the "stayed inactive"
// line above — same reason it is ungated: it exists for the developer who does
// not yet suspect the kit.
//
// Contract (identical in every kit): the ABSENCE of the fields (an
// older server, a non-JSON body, an unreadable body, a beacon with no readable
// reply) means "nothing to report" — no warning, no crash, no guessing. Nothing
// is uploaded; the warning is local output only. A cause key the kit does not
// know is counted in the total and named nowhere — never invent an explanation.

/** Why the server threw a row away. Mirrors the server's `DropCause`. */
type DropCause = "labelRejected" | "traceCapReached" | "snapshotEntryFiltered";

const DROP_CAUSE_KEYS: readonly DropCause[] = [
  "labelRejected",
  "traceCapReached",
  "snapshotEntryFiltered",
];

/** Short cause text — the same words the project's web page uses, so the panel
 *  and the dashboard never tell two different stories. */
const DROP_CAUSE_TEXT: Record<DropCause, string> = {
  labelRejected: "route names the privacy guard refused",
  traceCapReached: "spans past the 20-span limit",
  snapshotEntryFiltered: "snapshot entries the privacy guard refused",
};

/** What the developer changes to stop it. Second sentence of the warning. */
const DROP_CAUSE_FIX: Record<DropCause, string> = {
  labelRejected: "Name routes in code, the way GET /orders is written.",
  traceCapReached:
    "A trace keeps its first 20 spans \u2014 measure fewer steps per request, or split a very long trace.",
  snapshotEntryFiltered:
    "Name screens in code, never from what a person typed or an id.",
};

function dropFiniteCount(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return 0;
  return Math.floor(v);
}

// Cumulative for the life of the page: it is the size of the hole in the
// dashboard, so a later clean upload does not erase it.
let droppedRows = 0;
const seenDropCauses = new Set<DropCause>();
const warnedDropCauses = new Set<DropCause>();

/** How many rows the server has refused since this page loaded. */
export function getDroppedRowCount(): number {
  return droppedRows;
}

/** The causes seen so far, in the fixed cause order. Empty when nothing has
 *  been dropped. Display-only; carries code-defined markers, never server
 *  text. */
export function getDroppedRowCauses(): DropCause[] {
  return DROP_CAUSE_KEYS.filter((c) => seenDropCauses.has(c));
}

/** Emit the one-shot line for a cause on stderr via console.warn, ungated,
 *  never repeated — the same latch style as warnStayedInactiveOnce. Never
 *  throws (a host that replaced console must not crash on our warning). */
function warnDropCauseOnce(cause: DropCause, count: number): void {
  if (warnedDropCauses.has(cause)) return;
  warnedDropCauses.add(cause);
  try {
    console.warn(
      `[boosthis] Boosthis dropped ${count} of the measurements this app sent: ` +
        `${DROP_CAUSE_TEXT[cause]}. ${DROP_CAUSE_FIX[cause]}`,
    );
  } catch {
    // A broken console must never take the host down.
  }
}

/** ONE INSTALL, MANY VISITORS. A snapshot receipt says when the next snapshot
 *  from this install is useful (`nextSnapshotInMs`, only when several
 *  browsers share it) and from what share of visits samples and spans are
 *  wanted (`visitShare.oneIn`). Both go into the shared pacing record, so
 *  every tab follows them. A body without the fields changes nothing. */
export function noteReceiptPacing(body: unknown): void {
  try {
    if (!body || typeof body !== "object") return;
    const rec = body as {
      nextSnapshotInMs?: unknown;
      visitShare?: { oneIn?: unknown } | null;
    };
    if (rec.nextSnapshotInMs !== undefined) recordSnapshotHint(rec.nextSnapshotInMs);
    if (rec.visitShare && typeof rec.visitShare === "object") {
      recordVisitShare(rec.visitShare.oneIn);
    }
  } catch {
    // pacing advice must never fail an upload
  }
}

/** Record what one upload reply said, and warn once per cause. Safe to call
 *  with anything: a reply without the fields, a string, null. Only a body that
 *  reports a positive `dropped` changes any state or prints anything. Never
 *  throws — telling someone about a dropped row must never break an upload. */
export function noteServerDrops(body: unknown): void {
  try {
    if (!body || typeof body !== "object") return;
    const rec = body as Record<string, unknown>;
    const total = dropFiniteCount(rec["dropped"]);
    if (total <= 0) return;
    droppedRows += total;
    const raw = rec["droppedByCause"];
    if (raw && typeof raw === "object") {
      const causes = raw as Record<string, unknown>;
      for (const cause of DROP_CAUSE_KEYS) {
        const n = dropFiniteCount(causes[cause]);
        if (n > 0) {
          seenDropCauses.add(cause);
          warnDropCauseOnce(cause, n);
        }
      }
    }
  } catch {
    // Reading the reply must never fail an upload.
  }
}

/** Read an upload reply's body and record what it says. Fire-and-forget: the
 *  caller does not await it, so a slow or unreadable body can never slow an
 *  upload. A beacon (no readable reply) or a body without the fields reports
 *  nothing, by contract. */
async function readDropsFromResponse(res: unknown): Promise<void> {
  try {
    const r = res as { json?: () => Promise<unknown>; text?: () => Promise<string> } | null;
    if (!r || (typeof r.json !== "function" && typeof r.text !== "function")) return;
    // Bounded while reading: too large, too slow or not JSON says nothing.
    const body = await readAnswerJson(r);
    noteServerDrops(body);
    noteReceiptPacing(body);
  } catch {
    // No body, not JSON, already consumed — nothing to report, by contract.
  }
}

/** Called ONLY where the server answered 2xx to a MEASUREMENT upload — the one
 *  place the kit already treats a reply as "an upload was accepted". A 202 is
 *  not unqualified success: the server may have stored fewer rows than we sent.
 *  Read the honesty fields WITHOUT awaiting them, off the upload path, so a
 *  slow or unreadable body can never slow an upload. Never throws. */
function noteMeasurementUploadAccepted(res: unknown): void {
  try {
    noteUploadAccepted();
    void readDropsFromResponse(res);
  } catch {
    // reading the reply must never fail an upload
  }
}

export type UploadFailReason =
  | "unauthorized"
  | "rejected"
  | "server-error"
  | "unreachable";

let lastUploadFailAtMs: number | null = null;
let lastUploadFailReason: UploadFailReason | null = null;
let droppedUploads = 0;
let lastAttemptFailed = false;

export function noteUploadAccepted(): void {
  try {
    lastAttemptFailed = false;
  } catch {
    /* a status-mirror write must never fail an upload */
  }
}

export function noteUploadRejected(reason: UploadFailReason): void {
  try {
    lastUploadFailAtMs = Date.now();
    lastUploadFailReason = reason;
    droppedUploads += 1;
    lastAttemptFailed = true;
  } catch {
    /* a status-mirror write must never fail an upload */
  }
}

export function getLastUploadFailure(): {
  at: number;
  reason: UploadFailReason;
} | null {
  if (lastUploadFailAtMs === null || lastUploadFailReason === null) return null;
  return { at: lastUploadFailAtMs, reason: lastUploadFailReason };
}

export function getDroppedUploadCount(): number {
  return droppedUploads;
}

export function isLastUploadAttemptFailed(): boolean {
  return lastAttemptFailed;
}

export function _resetUploadFailureForTests(): void {
  lastUploadFailAtMs = null;
  lastUploadFailReason = null;
  droppedUploads = 0;
  lastAttemptFailed = false;
}

export function _noteUploadResponseForTests(
  res: Response,
  kind: PaceKind = "samples",
): boolean {
  try {
    // NOTHING WAS SENT. Every measurement upload lands here to be judged, and
    // when the kill-switch or a killed install silences the POST the transmit
    // helper still has to return a Response, so it invents a 204 — which is
    // `ok`. Judged as a success it would clear a real earlier failure, read
    // "drops" out of a body Boosthis never wrote, and hand the caller a
    // delivered-row count for rows that never left the page: the same false
    // green the registration path had, on six more surfaces.
    //
    // A locally-invented answer is evidence about US, never about the server.
    // It delivers nothing, so the caller counts zero, and it clears nothing.
    // It is not recorded as a refused batch either — the batch was not
    // refused; the kit is switched off, which the kit already says in its own
    // words (the lock notice, the status page's own rows and the registration
    // verdict), and an upload-failure line on top of that would describe a
    // fault that never happened.
    if (isNoSendResponse(res)) return false;
    if (res.ok) {
      noteMeasurementUploadAccepted(res);
      return true;
    }
    // ASKED TO WAIT, NOT REFUSED. A 429 says this install has used its
    // allowance for the moment and names how long to wait. Nothing about the
    // batch was judged, so it is neither "refused" nor "lost": the caller
    // holds it, every path in every tab holds off until the wait is over
    // (uploadPacing.ts), and it goes out with the next permitted upload. The
    // panel and the status page word this as a pause with an end time.
    if (res.status === 429) {
      // The kit's own answer under a wait already in force restates that
      // wait; only Boosthis's 429 starts (or lengthens) one.
      if (!isLocalPauseAnswer(res)) holdForStatedWait(kind, retryAfterOf(res));
      return false;
    }
    noteUploadRejected(
      res.status === 401 || res.status === 403
        ? "unauthorized"
        : res.status >= 500
          ? "server-error"
          : "rejected",
    );
  } catch {
    /* recording the result must never fail an upload */
  }
  return false;
}

function noteUploadUnreachable(): void {
  try {
    noteUploadRejected("unreachable");
  } catch {
    /* recording the result must never fail an upload */
  }
}

function uploadPayloadRefused(payload: unknown): boolean {
  try {
    assertNoPII(payload);
    return false;
  } catch {
    noteUploadRejected("rejected");
    return true;
  }
}
/** The panel figure: `"6 \u2014 route names the privacy guard refused; spans
 *  past the 20-span limit"`. Empty string when nothing has been dropped, so a
 *  healthy app shows nothing at all. */
export function dropSummaryText(): string {
  if (droppedRows <= 0) return "";
  const causes = getDroppedRowCauses().map((c) => DROP_CAUSE_TEXT[c]);
  return causes.length > 0
    ? `${droppedRows} \u2014 ${causes.join("; ")}`
    : String(droppedRows);
}

/** Test-only: forget every drop and every drop warn-once latch. */
export function _resetDropReportForTests(): void {
  droppedRows = 0;
  seenDropCauses.clear();
  warnedDropCauses.clear();
}

/** S5 of the silent-failure audit: how long the kit waits before quietly
 *  retrying a REJECTED registration (401/403 — bad/revoked/rotated invite
 *  key). A long-lived tab/SPA used to try exactly once at load and then stay
 *  dark until a reload even after the key was fixed server-side (rekey,
 *  rotation); one quiet retry per hour lets it come back WITHOUT a reload.
 *  A registration that got no usable answer is chased on the faster ladder
 *  instead (CONSENT_CHASE_LADDER_MS), clamped by this value so one test seam
 *  compresses both. Never prints again (the warn stays one-shot). */
let consentRetryMs = 60 * 60 * 1000;

/** Test-only: shrink the consent retry interval. */
export function _setConsentRetryMsForTests(ms: number): void {
  consentRetryMs = ms;
}

/** A credential renewal Boosthis ANSWERED is not repeated from the same
 *  credential for this long — the PHP kit's settled memo
 *  (lib/boosthis-php/src/CredentialRenewal.php). */
const RENEWAL_ANSWERED_MS = 60 * 60 * 1000;
/** A renewal that got no answer may be tried again from the next refused
 *  request after this, then on the retry ladder, never sooner. */
const RENEWAL_UNANSWERED_MS = 60 * 1000;

/** What one registration round trip came to: the status the caller has
 *  always been handed, and whether Boosthis ANSWERED it — a real reply it can
 *  act on, as opposed to no reply, a timeout, a 408/429/5xx, a 404 from
 *  routing, or a 2xx that is somebody else's page. Only an answered call
 *  settles a renewal, and only an unanswered one is chased. */
type ConsentOutcome = { status: number; answered: boolean };

/** Longest display name the server stores (matches the `.max(60)` on the
 *  consent schema). Clamp client-side so a long name is trimmed rather than
 *  rejected at ingest. */
const APP_NAME_MAX = 60;

/** How long a registration answer's "Detailed crash reports" switch is
 *  trusted before this browser asks again (once). */
export const CRASH_DETAILS_MEMORY_MS = 24 * 60 * 60 * 1000;

/** Sample-upload batching: flush at most this often… */
const SAMPLE_FLUSH_MS = 30_000;
/** …and never ship more than the server's batch cap in one POST. */
const MAX_SAMPLE_BATCH = 100;
/** A closing page does not send a snapshot when its browser sent one within
 *  this long: the server keeps only the latest per install, and the next
 *  page (a reload) continues the schedule. */
const SNAPSHOT_EXIT_SKIP_MS = 10_000;

/**
 * Decide the display name sent on consent. Unlike Node (which auto-detects
 * from package.json), the web runtime uses ONLY an explicit `opts.appName`:
 * the obvious auto-source — `document.title` — is user-visible page state
 * that routinely embeds dynamic user content ("Inbox (3) — jane@…"), so
 * auto-detection here would be a PII footgun, not a convenience. The explicit
 * value is clamped and dropped (never thrown on) if it trips the PII guard.
 */
export function resolveAppName(
  explicit: string | undefined,
): string | undefined {
  if (typeof explicit !== "string" || !explicit.trim()) return undefined;
  const clamped = explicit.trim().slice(0, APP_NAME_MAX);
  return checkNoPII({ appName: clamped }) === null ? clamped : undefined;
}

export interface TelemetryOptions {
  installId: string;
  endpoint?: string;
  /** YOUR SITE'S OWN VERSION, if you want Boosthis to record it.
   *
   *  The kit always reports its own version, built in and unchangeable, so a
   *  required kit update can tell old copies from new. A value given here is
   *  recorded as your site's release, marked as declared, and never replaces
   *  the kit's version. Up to 60 characters of letters, digits, dot, dash,
   *  underscore and plus, starting alphanumeric; anything else is dropped. */
  packageVersion?: string;
  /** Optional friendly display name for this app, sent on consent so you can
   *  tell your installs apart in your own Boosthis dashboard. Developer-
   *  authored metadata — never put a user's name, email, or any PII here; the
   *  guard screens the value and DROPS it (registration still succeeds) if it
   *  looks identifying. Capped at 60 chars. */
  appName?: string;
  fetchOptions?: InternalPostOptions;
  /** Previously-issued bearer token (e.g. restored from storage on boot).
   *  When absent the client calls /installs/consent to get one. */
  deleteToken?: string;
  /** Fired whenever the server issues a delete token whose VALUE differs from
   *  the one currently held — first issuance, or fresh credentials replacing a
   *  stale restored token. The runtime does NOT persist the delete token
   *  itself (only the read token + installId), so the host should persist its
   *  own copy here and seed it back via `deleteToken` on the next load. */
  onTokenIssued?: (token: string) => void;
  /** Previously-issued SELF-scoped read token. The runtime also persists it
   *  itself (localStorage, `boosthis:` namespaced), so this option is only
   *  needed to seed a token the host already has. */
  readToken?: string;
  /** Fired whenever the server issues a read token whose VALUE differs from
   *  the one currently held. */
  onReadTokenIssued?: (token: string) => void;
  /** Shared invite key authorizing this install to register. Sent as
   *  `Authorization: Bearer <inviteKey>` on /installs/consent. */
  inviteKey?: string;
  /** Issues-only mode. When true the client NEVER ships per-page samples:
   *  `transmit()` becomes a no-op and samples are never queued. The snapshot
   *  mirror stays off too unless `shareMeterWithAI` (explicit or server
   *  directive) turns it on. */
  issuesOnly?: boolean;
  /** Explicit opt-in to mirror the PII-filtered perf SNAPSHOT (per-page rows +
   *  axes) to the server so the developer's OWN AI can read the live picture
   *  over the hosted MCP live-read tools. Default false. In full mode the
   *  snapshot ships anyway; this flag only matters in issues-only mode. It
   *  never enables the raw per-page sample firehose. */
  shareMeterWithAI?: boolean;
  /** Send this site's PAGE MAP — the pages the kit has seen opened, and the
   *  paths between them — alongside the snapshot it already uploads. Default
   *  true since 1.0.0-alpha.144 (it was an opt-in before). Pass `false` to
   *  keep navigation on the device: the record is still kept in memory for
   *  the panel, and nothing about it is sent.
   *
   *  It carries page LABELS ONLY: the same normalized route labels already on
   *  every sample and span, plus pairs of them with counts. There is no field
   *  on the wire for a control, a gesture, a coordinate or anything read from
   *  the DOM, and no option adds one (see `pageMapWire.ts`).
   *
   *  It rides the snapshot's gates exactly — consent, kill-switch,
   *  entitlement and issues-only all apply, so in issues-only mode this sends
   *  nothing unless `shareMeterWithAI` is also on. */
  sendPageMap?: boolean;
  /** Join the page's calls to its OWN origin to the routes they reach.
   *  Default true since 1.0.0-alpha.144: each same-origin `fetch` or XHR
   *  carries the three `x-boosthis-*` trace headers, and the kit records one
   *  traced step for it, labelled with the page's route label — so your
   *  server's step for that request links back to the page on the map. A
   *  same-origin call needs no CORS allowance, so the headers cannot get it
   *  refused. Pass `false` to send your calls exactly as written; nothing is
   *  then traced unless you use `traceFetch`. Rides the span gates: nothing is
   *  attached or recorded unless this visit may share. */
  traceSameOrigin?: boolean;
  /** Other hosts that may receive the trace headers, by exact name
   *  (`["api.example.com"]`), or `".example.com"` for that host and every host
   *  under it. Empty by default, and there is no wildcard: a custom header on
   *  a cross-origin call makes the browser ask that host first, and a host
   *  that does not allow `x-boosthis-trace`, `x-boosthis-parent` and
   *  `x-boosthis-trace-elapsed` gets the call refused. Name a host only once
   *  its CORS settings allow those three headers. */
  tracePropagateTo?: readonly string[];
  /** THE END USER'S PERMISSION — not the registration handshake.
   *
   *  What state to start in, out of `granted` | `withheld` | `memory-only`.
   *  Default `granted`: an install that says nothing behaves exactly as it
   *  always has. Pass `"withheld"` to start inert — nothing is written to the
   *  visitor's device and nothing leaves the page — and call
   *  `setEndUserConsent("granted")` from your banner when they agree.
   *
   *  Deliberately NOT `consent` and NOT related to `client.consent()`, which
   *  is the handshake that registers this install with the Boosthis server.
   *  See docs/decisions/end-user-device-storage-consent.md. */
  endUserConsent?: EndUserConsent;
  /** Read `navigator.doNotTrack` / `navigator.globalPrivacyControl` once at
   *  start and begin in `withheld` when either is set. Default false, because
   *  reading a browser preference as a consent answer is a legal conclusion
   *  about your visitors and it is yours to reach, not ours. An explicit
   *  `endUserConsent` always wins over this. */
  respectDoNotTrack?: boolean;
  /** Opt in to the crash reporter's DETAILED mode. Default false. When false,
   *  a crash report carries only the always-on closed schema (error name, a
   *  code-derived hashed signature, a redacted top frame, a bucketed count).
   *  When true it also adds a PII-scrubbed first message line + sanitized
   *  frames (function + file basename + line/col). Both modes pass the shared
   *  PII guard before upload. */
  crashDetails?: boolean;
}

export interface TelemetrySample {
  routeLabel: string;
  durationMs: number;
  rating: Rating;
  ruleId?: string;
  /** What a page-load reading says about itself: which timing the number is,
   *  and how the page was opened. Two closed lists (pageLoadTiming.ts); any
   *  other word is dropped before upload, and the server drops it again. */
  metadata?: TelemetrySampleMetadata;
}

export interface TelemetrySampleMetadata {
  timing?: PageLoadTiming;
  opened?: PageOpened;
  /** `router` when a handed-over router named the reading's screen by its
   *  route pattern; absent when the address did. One word, closed. */
  naming?: "router";
}

/** The metadata a sample may carry on the wire: only words from the closed
 *  lists survive, so a sample handed over from an older page — or built by a
 *  direct transmit() caller — can never put anything else on it. */
function wireSampleMetadata(
  m: TelemetrySampleMetadata | undefined,
): TelemetrySampleMetadata | null {
  if (!m || typeof m !== "object") return null;
  const out: TelemetrySampleMetadata = {};
  if (typeof m.timing === "string" && PAGE_LOAD_TIMINGS.includes(m.timing)) out.timing = m.timing;
  if (typeof m.opened === "string" && PAGE_OPENED_WORDS.includes(m.opened)) out.opened = m.opened;
  if (m.naming === "router") out.naming = "router";
  return out.timing !== undefined || out.opened !== undefined || out.naming !== undefined
    ? out
    : null;
}

/** One recurring-problem signature. Everything here is built by the kit from
 *  the shared vocabulary plus two buckets — there is no route label, no URL, no
 *  value and no code on this channel. Shape is identical in every kit. */
export interface CandidateSignaturePayload {
  signature: string;
  kind: string;
  severityBucket: "low" | "med" | "high";
  countBucket: string;
  occurrences: number;
  /** The page the problem was seen on, or the closed reason there is none. */
  routeLabel?: string;
  partUnknown?: string;
  /** The measured facts that point at the cause (problemCause.ts). */
  cause?: ProblemCause;
}

/** Privacy-safe fix-resolution signal. NEVER carries code, diffs, page names,
 *  or values — only the kind + before→after rating, plus the bucketed
 *  circumstances the problem held BEFORE the fix. */
export interface ResolutionPayload {
  ruleId: string;
  kind: string;
  beforeRating: "good" | "needs-work" | "poor";
  afterRating: "good" | "needs-work" | "poor";
  occurrences: number;
  severityBucket?: "low" | "med" | "high";
  countBucket?: string;
}

export interface TelemetryClient {
  readonly installId: string;
  readonly endpoint: string;
  readonly enabled: boolean;
  readonly deleteToken: string | null;
  /** SELF-scoped read token for this install, or null until consent has
   *  issued one (or it was restored from storage / `opts.readToken`).
   *  Read-only: it can read this install's own uploaded perf data over the
   *  hosted MCP live-read path, but can never delete or ingest. */
  readonly readToken: string | null;
  /** Effective project key decision, including its safe display and source. */
  readonly projectKey: ResolvedProjectKey;
  /** The EFFECTIVE full-telemetry mode right now: code config (`issuesOnly:
   *  false`) OR the dashboard "Full telemetry" directive. The bubble's
   *  signed-in account card reads this so its telemetry toggle can fall back to
   *  the kit's current mode when the claim response omits `fullTelemetry`. */
  readonly fullTelemetryEffective: boolean;
  /** Whether ANY meter is actually being shared to the server dashboard right
   *  now: full mode (code config OR the server "Full telemetry" grant) OR the
   *  `shareMeterWithAI` opt-in (explicit OR the server directive). Display-only,
   *  read by the bubble's panel so a registered-but-silent install can SAY it
   *  is silent instead of looking healthy while the dashboard stays empty. It
   *  reflects the sharing CHOICE, not the transient kill-switch/disable state. */
  readonly meterSharing: boolean;
  /** Apply the dashboard "Full telemetry" directive IN-SESSION — the SAME code
   *  path postConsent() runs when the consent response carries `fullTelemetry`.
   *  The account card calls this after its own successful toggle POST so the
   *  new mode takes effect immediately (no relaunch): ON forces full mode for
   *  the session (sample firehose + snapshot mirror); OFF reverts to the
   *  code-configured mode. Never overrides disable()/forget()/BOOSTHIS_DISABLED.
   */
  applyServerFullTelemetry(on: boolean): void;
  consent(): Promise<number>;
  /** Ask Boosthis for a working install credential in place of the one this
   *  page holds, returning the fresh credential (or null when none was
   *  issued).
   *
   *  WHY: a second browser or tab that re-consents for this same install is
   *  handed the install's credential back, and that re-issue ROTATES — the
   *  copy still holding the previous one silently loses the ability to prove
   *  itself. The upload paths and the check-in renew by themselves when
   *  Boosthis says so; the panel's own actions (linking the project, changing
   *  the telemetry grant) call this ONCE on a refusal and retry. The ordinary
   *  consent path — same install id, same project key, no credential
   *  presented — hands this page a working credential back.
   *
   *  `refused` is the credential the refused request carried, when the caller
   *  knows it; without it, the credential held now is the one renewed from.
   *  Every renewal on this page is the SAME renewal: a call made while one is
   *  running waits for it and shares its answer, a credential is renewed from
   *  at most once, and a credential Boosthis handed back on renewal that is
   *  refused again answers null instead of renewing in a loop.
   *
   *  Deliberately narrow. It does nothing unless a credential is actually
   *  held (a page holding none was not overtaken by anything, so a refusal
   *  there has another cause), and it can NEVER mint a new identity: a
   *  re-consent that finds nothing to restore leaves this page exactly as it
   *  was rather than registering a second install under the same project. */
  renewCredential(refused?: string | null): Promise<string | null>;
  transmit(
    samples: readonly TelemetrySample[],
    opts?: { keepalive?: boolean },
  ): Promise<number>;
  /** Upload one PII-filtered perf snapshot. Gated off in issues-only mode
   *  unless `shareMeterWithAI` (explicit or server directive) is set; always
   *  gated off when disabled or killed. Pass `keepalive: true` from a
   *  pagehide handler so the request outlives the page. Returns 1 on
   *  success. */
  transmitSnapshot(
    snapshot: WebSnapshotPayload,
    opts?: { keepalive?: boolean },
  ): Promise<number>;
  /** Queue privacy-safe crashes durably. Not gated by disable()/issuesOnly.
   *  Direct calls return 0 (queued, not accepted). The sealed delivery path
   *  receives the real HTTP status, or 0 when nothing was sent. */
  transmitCrashes(crashes: readonly CrashReportPayload[], sealed?: CrashBatch, keepalive?: boolean): Promise<number>;
  /** Upload a batch of recurring-problem signatures. ALWAYS-ON for a registered
   *  app, exactly like `transmitCrashes`: not gated by `disable()`/`issuesOnly`,
   *  stopped only by the kill-switch or `forget()`. Pass `keepalive: true` from
   *  a pagehide handler so a closing page still delivers its report. Returns
   *  the number accepted, or a refusal the stored queue can narrow. */
  transmitCandidates(
    signatures: readonly CandidateSignaturePayload[],
    opts?: { keepalive?: boolean },
  ): Promise<CandidateUploadResult>;
  /** Upload a batch of fix outcomes. Same always-on gate as
   *  `transmitCandidates`. Returns the number accepted or a permanent refusal. */
  transmitResolutions(
    resolutions: readonly ResolutionPayload[],
    opts?: { keepalive?: boolean },
  ): Promise<CandidateUploadResult>;
  /** Upload a batch of privacy-safe trace spans. Rides the same allow-gate as
   *  the snapshot mirror (off on a private app until sharing is authorized).
   *  Returns the number of spans accepted. */
  transmitSpans(spans: readonly TraceSpan[]): Promise<number>;
  disable(): void;
  enable(): void;
  forget(): Promise<number>;
}

/** Mirrors the server's consent-time installId validation (zod `.uuid()` — any
 *  8-4-4-4-12 hex layout, case-insensitive). Consent is fire-safe, so a
 *  wrong-shaped id would otherwise fail SILENTLY server-side (the app runs but
 *  never registers). Validating here fails loud at the one moment the
 *  developer is looking. */
const INSTALL_ID_SHAPE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * UUIDv4 generator for the self-healing reinstall recovery. Prefers the
 * platform's crypto.randomUUID (modern browsers/Node) and falls back to a
 * Math.random v4 — acceptable HERE because the rotated install id is an
 * IDENTIFIER, not an authenticator ("install ids are identifiers, not
 * authenticators" is a server-side invariant): every capability still rides
 * the server-minted delete/read tokens. Exported for tests.
 */
export function generateRotationInstallId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === "function") {
    try {
      return c.randomUUID();
    } catch {
      /* fall through to the dependency-free path */
    }
  }
  let out = "";
  for (const ch of "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx") {
    if (ch === "x") out += ((Math.random() * 16) | 0).toString(16);
    else if (ch === "y") out += (((Math.random() * 4) | 0) + 8).toString(16);
    else out += ch;
  }
  return out;
}

/**
 * The widening ladder a registration that never completed is chased on — now
 * the one schedule every retry in this kit shares (retrySchedule.ts), and
 * still exported here because it is the HORIZON the kit promises a developer
 * when it says a failed registration is not final.
 */
export { CONSENT_CHASE_LADDER_MS, _setRetrySpreadForTests } from "./retrySchedule";

/**
 * WHAT THIS KIT IS READY TO SEND BEFORE ANYONE HAS DECIDED — the sharing
 * posture of a brand-new install in the window between this process starting
 * and the server's first answer.
 *
 * Declared ONCE for the whole product in lib/telemetry-mode-contract.json.
 * This is the copy this kit reads, and a guard reads the literal back out of
 * this file and fails when the two diverge without a written reason. A NAMED
 * constant rather than a bare literal beside `opts.issuesOnly`, so the
 * pre-contact answer is a stated position somebody can find rather than the
 * same word hardcoded once per kit with nothing holding the copies together.
 *
 * Nothing can actually leave the device in that window regardless — every
 * upload path also needs the delete token the consent answer mints — so this
 * decides what the kit is READY to send, not what it has sent.
 */
export const PRE_CONTACT_FULL_TELEMETRY_DEFAULT = true;

export function enableTelemetry(opts: TelemetryOptions): TelemetryClient {
  // While Angular renders on the server there is no visitor and nothing to
  // send: hand back a client that does nothing, having scheduled nothing
  // (browserPage.ts). Decided before the install id is checked, so a server
  // render never throws on an id only the browser holds.
  if (inServerRender() || isDissolvedThisRun()) return inertTelemetryClient(opts);
  // Every timer, listener and request the kit starts from here is its own
  // work, so it starts outside an Angular app's zone (zoneSafe.ts).
  return outsideAngular(() => enableTelemetryNow(opts));
}

/**
 * The client a server render gets: the same shape, every action a no-op,
 * every answer the one a switched-off kit gives. Nothing here reads storage,
 * schedules work or reaches the network.
 */
function inertTelemetryClient(opts: TelemetryOptions): TelemetryClient {
  const endpoint = opts.endpoint ?? DEFAULT_TELEMETRY_ENDPOINT;
  const projectKey = resolveProjectKey(opts.inviteKey);
  const installId = typeof opts.installId === "string" ? opts.installId : "";
  return {
    installId,
    endpoint,
    enabled: false,
    deleteToken: null,
    readToken: null,
    projectKey,
    fullTelemetryEffective: false,
    meterSharing: false,
    applyServerFullTelemetry() {},
    consent: async () => 0,
    renewCredential: async () => null,
    transmit: async () => 0,
    transmitSnapshot: async () => 0,
    transmitCrashes: async () => 0,
    transmitCandidates: async () => 0,
    transmitResolutions: async () => 0,
    transmitSpans: async () => 0,
    disable() {},
    enable() {},
    forget: async () => 0,
  };
}

function enableTelemetryNow(opts: TelemetryOptions): TelemetryClient {
  const freshAfterDissolved = restartingDissolved();
  if (freshAfterDissolved) opts = { ...opts, deleteToken: undefined };
  if (!opts.installId || typeof opts.installId !== "string") {
    throw new Error("enableTelemetry requires opts.installId (UUIDv4 string)");
  }
  if (!INSTALL_ID_SHAPE.test(opts.installId)) {
    throw new Error(
      "enableTelemetry: opts.installId must be a UUID (8-4-4-4-12 hex, e.g. crypto.randomUUID()) — the server rejects any other shape at registration, so the install would silently never appear",
    );
  }
  // THE END USER'S PERMISSION, APPLIED BEFORE ANYTHING IS READ OR WRITTEN.
  //
  // First statement of the start path on purpose: everything below this line
  // touches the visitor's device — the rotation mapping, the read token, the
  // install id — and a gate applied after those reads would have let the very
  // storage it exists to prevent happen once per page load.
  //
  // A start call that names nothing leaves the state alone (see
  // resolveStartConsent): `setEndUserConsent("withheld")` followed by a plain
  // `enableTelemetry({ installId })` must stay withheld.
  {
    const asked = resolveStartConsent(opts);
    if (asked !== null) setEndUserConsent(asked);
  }
  // A DEVELOPMENT PAGE NEVER WEARS THE LIVE SITE'S INSTALL.
  //
  // The baked id is the live site's, and the server hands its credentials to
  // any browser presenting it — so the developer's own localhost page used to
  // file its mid-edit crashes in the live record, take over the live snapshot
  // and spend the live upload allowance. A page this kit can RECOGNISE as
  // development (a development build, or a loopback address — nothing else,
  // see developmentPage.ts) reports as the project's separate development
  // install instead: an id derived from the baked one, declared "development"
  // at registration. Done here, before the read token, the rotation mapping or
  // anything else keys off the id, so every store and every send below uses
  // the development id and never the live one. This is the one reasoned
  // exception to "the baked id always wins" (docs/install-identity-precedence.md).
  const pageEnvironment = pageEnvironmentNow();
  if (pageEnvironment === "development") {
    opts = { ...opts, installId: developmentInstallIdFor(opts.installId) };
  }
  const endpoint = opts.endpoint ?? DEFAULT_TELEMETRY_ENDPOINT;
  // Our own sends go out through the page's fetch, which the call watcher
  // wraps. Registering the endpoint keeps OUR replies out of the app's
  // hosting-cache reading.
  try {
    noteOwnEndpoint(endpoint);
  } catch {
    /* observing must never disturb the page */
  }
  const projectKey = resolveProjectKey(opts.inviteKey);
  activeProjectKey = projectKey;
  // The module install supplies the key HERE, one statement after the kit's
  // start call. Hand it to the startup line before it gives up waiting, so the
  // anchor line names the key instead of claiming there is none.
  try {
    announceProjectKey(projectKey.key);
  } catch {
    /* evidence never blocks reporting */
  }
  // NO KEY IS A STATE, NOT A SILENCE.
  //
  // A page with no project key measures itself perfectly and appears nowhere:
  // no project row on the owner's dashboard, so no chart and no alert about
  // this app can ever exist. That is a supported mode — but it is IDENTICAL,
  // from the outside, to a key that simply failed to arrive, which is how a
  // real customer's site stayed invisible. So the kit records which of the two
  // this is the moment it knows, and the panel and status readout show it from
  // here on. (The console line waits for the first round trip to settle, so a
  // sharper fault can claim the page's one line — see postConsent.)
  if (!projectKey.key) {
    setRegistrationRefusalKind(
      projectKey.declined ? "no-key-chosen" : "no-key-missing",
    );
    // Backstop for the page that never gets as far as a round trip (no gate
    // accepted, consent never attempted, the tab closed early). Without it the
    // console line would depend on a call that may never happen — and silence
    // is the exact failure this whole change exists to end. Long enough that a
    // real round trip wins the line; the latch makes it a no-op if it did.
    try {
      const t = kitTimeout(() => {
        warnNoProjectKeyIfStillUnexplained();
      }, NO_KEY_ANNOUNCE_DELAY_MS);
      // Never hold a Node-side test process (or an SSR render) open for this.
      const handle = t as unknown as { unref?: () => void };
      if (typeof handle.unref === "function") handle.unref();
    } catch {
      /* a host without timers must not fail to start */
    }
  }
  if (projectKey.overrodeShared && !warnedProjectKeyOverride) {
    warnedProjectKeyOverride = true;
    try {
      console.warn(
        `[boosthis] Web project key overridden by __BOOSTHIS_PROJECT_KEY_WEB__ (${projectKey.display}).`,
      );
    } catch {
      /* a host that replaced console must not break registration */
    }
  }
  // Every upload, registration and check-in carries THIS kit's version, fixed
  // when the kit was built. A required kit version can only stop the copies it
  // can place, so nothing the page passes in may change or blank it. A value
  // the page hands over as `packageVersion` names the SITE's release and goes
  // in the registration's own block for that (see appVersionFacts.ts).

  // OUR OWN UPLOADS ARE NOT THE APP'S CALLS.
  //
  // The call watcher wraps the page's `fetch` so a hanging backend call is
  // visible. Everything below goes out through that same `fetch`, so left
  // alone the kit would file its own registration, snapshots and spans as one
  // of the app's backend destinations — and in the app this reading exists
  // for, a front end with no backend of its own, ours could be the only
  // destination reported. Send under our own wrapper instead, resolved per
  // call so it is right whichever order the host starts things in. A host's
  // own `fetchImpl` always wins, and when nothing is wrapped this is the
  // page's ordinary `fetch`.
  const fetchOptions: InternalPostOptions = {
    ...(opts.fetchOptions ?? {}),
    fetchImpl:
      opts.fetchOptions?.fetchImpl ??
      (((input: unknown, init?: unknown) =>
        (unwatchedFetch() ?? fetch)(
          input as RequestInfo,
          init as RequestInit,
        )) as unknown as typeof fetch),
  };
  const issuesOnly = opts.issuesOnly ?? !PRE_CONTACT_FULL_TELEMETRY_DEFAULT;
  const explicitShareMeterWithAI = opts.shareMeterWithAI ?? false;
  // On unless the host says otherwise (the default since 1.0.0-alpha.144).
  // There is no server directive that changes it either way: the page map
  // is the host's decision alone.
  const sendPageMap = opts.sendPageMap !== false;
  // Which of the page's calls carry the trace headers (pageCallTrace.ts):
  // its own origin unless switched off, other hosts only when named.
  configurePageCallTrace({
    sameOrigin: opts.traceSameOrigin,
    propagateTo: opts.tracePropagateTo,
  });
  // Remembered for the bubble, whose page-map row must not read as a purely
  // on-device record once the host has asked for it to be sent.
  pageMapSendRequested = sendPageMap;
  let serverShareMeterWithAI = false;

  // SECOND server directive — the dashboard "Full telemetry" switch, learned
  // from the consent response OR applied in-session by the bubble's account
  // card (applyServerFullTelemetry). A THREE-STATE value that follows BOTH
  // edges:
  //   • null  = the server has not told us yet — honour the code-configured
  //             mode (`issuesOnly`) until first contact.
  //   • true  = ON  — force full mode for the session (per-page sample firehose
  //             + snapshot mirror), even when the host code asked for
  //             issues-only (preserves the documented contract).
  //   • false = OFF — force issues-only for the session, even when the host
  //             code asked for full mode (fixes the defect where a dashboard
  //             "turn it off" was silently ignored).
  // It can never override disable()/forget()/the kill-switch — every upload
  // path re-checks `enabled` + the kill-switch. Initialised to null (NOT false)
  // so it never fabricates an OFF the server never sent.
  let serverFullTelemetry: boolean | null = null;
  // The project's "Detailed crash reports" switch, as the last registration
  // answer for this install gave it. Restored below for the resolved install.
  let serverCrashDetails = false;

  /** The mode uploads actually run under: before the server has spoken
   *  (`serverFullTelemetry === null`) the code-configured `issuesOnly` wins;
   *  after first contact the server directive wins in BOTH directions. Inverse
   *  of effective full mode
   *  (`serverFullTelemetry === null ? !issuesOnly : serverFullTelemetry`).
   *  Mirrors Node/RN. */
  function effectiveIssuesOnly(): boolean {
    return serverFullTelemetry === null ? issuesOnly : !serverFullTelemetry;
  }

  /** SAY IT ONCE when this project's dashboard directive contradicts what the
   *  installed code asked for.
   *
   *  The server wins in both directions and always has; that is deliberate
   *  and this warning does not dispute it. What it ends is a developer
   *  reading their own source, seeing the mode they set, and believing it
   *  while the switch on their project's page quietly says otherwise. BOTH
   *  values are named, so the line is actionable without first opening the
   *  dashboard to find out what it currently says.
   *
   *  One wording in every kit that warns — see
   *  lib/telemetry-mode-contract.json, which is also where a kit that does
   *  NOT warn has to write down why. */
  let telemetryModeContradictionAnnounced = false;
  function noteTelemetryModeContradiction(): void {
    if (telemetryModeContradictionAnnounced) return;
    // Nothing to contradict until the server has actually answered: before
    // first contact the code's setting is the only one there is.
    if (serverFullTelemetry === null) return;
    const requested = issuesOnly ? "reduced" : "full";
    const effective = effectiveIssuesOnly() ? "reduced" : "full";
    if (requested === effective) return;
    telemetryModeContradictionAnnounced = true;
    try {
      // NAMES THE ANSWER, NEVER THE SWITCH'S POSITION. A disconnected or
      // removed project is answered with the sharing directives withdrawn
      // while its switch may still be ON, so a line quoting that switch
      // would be false exactly where a developer most needs it. The kit
      // knows what it was told; it does not know why.
      console.warn(
        `[boosthis] telemetry mode: your code asked for ${requested} telemetry, but this project's server answer is ${effective}, so ${effective} is what is in force. The server answer wins in both directions: the "Full telemetry" switch on the project's page sets it, and a disconnected or removed project is answered with reduced until it is reconnected. Change it there, or drop the code setting so the two agree.`,
      );
    } catch {
      /* a host that replaced console must not break telemetry */
    }
  }

  let enabled = true;
  let deleteToken: string | null = opts.deleteToken ?? null;

  /* ─── A REGISTRATION THAT OUTLIVES THE PERMISSION IT WAS MADE UNDER ─────
   *
   * Registration is a round trip. A visitor who withdraws while one is in
   * flight used to be answered by it a moment later: the reply adopted a
   * delete token, wrote the install down as registered, and left an install
   * on our server that nobody was ever going to ask us to delete — because
   * the withdrawal read the token BEFORE the reply carried one, found
   * nothing, and sent no erasure at all.
   *
   * Two things close it. The generation is bumped the instant permission is
   * withdrawn, so a reply that crosses that line is recognisable and adopts
   * NOTHING; the token it was issued is kept aside instead, and the
   * withdrawal — which waits for the request it crossed — erases with it.
   *
   * Declared here, above `postConsent`, because the launch calls that before
   * this factory's last line runs: a `let` further down would be in its dead
   * zone and throw on the very first registration.
   */
  let withdrawalGeneration = 0;
  /** Registrations that have been asked and not yet answered. */
  const registrationsInFlight = new Set<Promise<unknown>>();
  let launchConsentAnswered = false;
  function waitingForUploadStart(): boolean {
    return !hasBeenActiveThisRun() ||
      (!launchConsentAnswered && (!deleteToken || registrationsInFlight.size > 0));
  }
  /** A regular send with rows to send that stands down while the kit is
   *  starting. Standing down must not stall the start itself: the upload
   *  paths are what register a page lazily, so a held send asks to register
   *  when nothing has asked. A send with nothing to send never asks, as
   *  before. */
  function holdForUploadStart(hasRows: boolean): boolean {
    if (!waitingForUploadStart()) return false;
    if (
      hasRows && !deleteToken && registrationsInFlight.size === 0 &&
      enabled && !isBoosthisDisabled() && !isDissolvedThisRun()
    ) {
      void postConsent({ onDemand: true }).catch(() => {
        // postConsent only throws on PII-guard bugs; never crash the host.
      });
    }
    return true;
  }
  /** Whether this page has asked to register at all, whatever came back.
   *  A failed ask arms its own retry ladder, so the first-page registration
   *  below never adds a second ask on top of one already made. */
  let registrationAskedThisPage = false;
  /** A delete token issued by a reply that landed after the withdrawal. Held
   *  for the erasure, never adopted as this client's credential. */
  let tokenIssuedAfterWithdrawal: string | null = null;

  /** Wait for every registration already asked. A registration started while
   *  we waited is waited for too — twice over, which is all a closed send
   *  gate can produce. Never throws. */
  async function settleRegistrationsInFlight(): Promise<void> {
    for (let round = 0; round < 3 && registrationsInFlight.size > 0; round++) {
      try {
        await Promise.allSettled(Array.from(registrationsInFlight));
      } catch {
        // allSettled does not reject; a broken thenable must not stop the
        // erasure that follows.
        return;
      }
    }
  }

  // SELF-scoped read token, persisted under a per-install key so multiple
  // installs sharing one origin never collide. Web storage is synchronous, so
  // the restore happens before the first consent round-trip — we never
  // overwrite a token already provided via opts.
  const readTokenStoreKey = `readToken:${opts.installId}`;
  let readToken: string | null = opts.readToken ?? null;
  if (!readToken) {
    const restored = storage.get(readTokenStoreKey);
    if (restored) {
      readToken = restored;
    }
  }
  // WHICH PROJECT this install feeds. Restore it beside the read token so the
  // panel can still name the project before this page's consent reply lands.
  const projectStoreKey = `project:${opts.installId}`;
  try {
    const storedProject = parseKitProject(storage.get(projectStoreKey));
    if (storedProject) setKitProject(storedProject.name, storedProject.code);
  } catch {
    // Best-effort: unreadable browser storage only delays the project name.
  }

  // ─── HOURLY CONSENT RETRY AFTER A REJECTED REGISTRATION (S5) ─────────────
  // One pending timer at most; re-armed only by another rejection. Guarded
  // `.unref()` for the Node-side entrypoints (a browser timer id has none).
  // Stopped on success, disable(), and forget(); the callback re-checks
  // enabled + kill-switch at fire time so a late tick can never resurrect a
  // stopped runtime.
  let consentRetryTimer: ReturnType<typeof setTimeout> | null = null;

  function stopConsentRetry(): void {
    consentChaseStep = 0;
    if (consentRetryTimer !== null) {
      clearTimeout(consentRetryTimer);
      consentRetryTimer = null;
    }
  }

  function scheduleConsentRetry(afterMs: number = consentRetryMs): void {
    if (isDissolvedThisRun() || freshAfterDissolved) return;
    if (consentRetryTimer !== null) return;
    consentRetryTimer = kitTimeout(() => {
      consentRetryTimer = null;
      if (!enabled || isBoosthisDisabled()) return;
      void postConsent().catch(() => {
        // postConsent only throws on PII-guard bugs; never crash the host.
      });
    }, afterMs);
    const t = consentRetryTimer as unknown as { unref?: () => void };
    if (typeof t.unref === "function") t.unref();
  }

  // ─── KEEP TRYING AFTER A REGISTRATION THAT NEVER COMPLETED ───────────────
  // The hourly loop above is for a key the SERVER refused: nothing changes
  // until somebody fixes it there, so asking more often is just noise. A
  // registration that never completed is the opposite case — a tab opened in a
  // tunnel, a proxy down for a minute, a 5xx mid-deploy — and it usually clears
  // by itself within seconds. Giving up after one attempt is what left a real
  // install unregistered for its whole session.
  //
  // A widening ladder, not a fixed interval: quick enough to catch the common
  // brief outage, slow enough that a page left open all day on a dead network
  // costs almost nothing. Each wait is spread a little (retrySchedule.ts) so
  // pages that failed together do not all ask again in the same second. The
  // same ladder carries a consent that PRESENTED a credential and got no real
  // answer: the owner's dashboard switches ride only that answer.
  let consentChaseStep = 0;

  function scheduleConsentChase(): void {
    const step = retryWaitMs(consentChaseStep);
    consentChaseStep += 1;
    // Clamped by the hourly rhythm so ONE test seam compresses both loops —
    // otherwise a test proving the chase would have to sleep for real seconds.
    scheduleConsentRetry(Math.min(step, consentRetryMs));
  }

  // ─── NO ASKING ON EVERY FLUSH AFTER A REFUSED REGISTRATION ───────────────
  // The hourly timer above is the only thing allowed to ask again after
  // Boosthis refused the project key (401/403) or answered that this install
  // id belongs to another copy and handed this page no credential. Without
  // this, every upload path's lazy `if (!deleteToken) postConsent()` asked
  // again on EVERY flush — and on a website every visitor is a page, so one
  // site with a revoked key spent the registration allowance other customers
  // share, once per visitor per flush. While this deadline is in the future
  // the upload paths' registrations return without touching the network. The
  // hourly retry, an explicit `consent()` and a visitor's own yes still ask,
  // and an accepted registration clears it. The Node kit has done this since
  // it met the same storm.
  let consentSuppressedUntil = 0;

  // ─── RENEWING A CREDENTIAL ANOTHER COPY REPLACED ─────────────────────────
  // Every visitor's browser is a copy of one website install, and a copy that
  // reconnects without its credential is handed the install's credential back
  // — which rotates it, leaving every other copy holding a dead one. Such a
  // page used to stay silent until its storage was cleared.
  //
  // Boosthis now says WHY it refused a credential (`credentialRefusal` on the
  // 401), and exactly one answer renews: "mismatch", the credential is not the
  // one on file because it was replaced. The page then asks again the
  // ordinary way without presenting the dead credential, adopts and announces
  // what comes back (the hosted tag and a module's `onTokenIssued` save it, so
  // the next visit starts healthy), and sends the refused upload once more.
  //
  // Guard rails, the same in every kit:
  //   • never on a 429, a 5xx, a network error, a missing credential, one
  //     Boosthis holds nothing for, or a cut-off install — renewing changes
  //     none of them;
  //   • never mints an install id and never takes the reinstall self-heal;
  //   • concurrent refusals share ONE renewal. A renewal the server ANSWERED
  //     is not repeated from the same credential for an hour; one that got
  //     no answer (no reply, a timeout, a 5xx, a 429, a page that is not
  //     ours) may be tried again from the next refused request after about a
  //     minute, then on the retry ladder — recording the attempt before it
  //     was sent and never clearing it left a page presenting a refused
  //     credential, every upload refused, until the next page load;
  //   • a credential the server handed back on renewal that is refused again
  //     stops here, reported, rather than looping;
  //   • the held credential is never dropped while asking, so an upload path
  //     running meanwhile cannot register a second time underneath it, and a
  //     renewal that brings nothing back leaves the page exactly as it was;
  //   • a closing page (a keepalive send) never starts one: its budget is the
  //     unload, and the next page's launch check-in renews instead.
  let renewalInFlight: Promise<string | null> | null = null;
  /** The renewal memo: which credential the last renewal started FROM, the
   *  moment before which no new renewal starts from it, and how many renewals
   *  from it in a row got no answer. The PHP kit's memo, kept in memory. */
  let renewalMemo: { from: string; until: number; misses: number } | null = null;
  /** What the last renewal produced, or null when it produced nothing. */
  let renewalProduced: string | null = null;
  /** The last credential the SERVER handed back on renewal. One this page
   *  found already replaced (a registration reply landed meanwhile) is not
   *  counted: if it is refused too, it is renewed from once, like any other. */
  let renewalRenewed: string | null = null;

  /** The single-flight renewal. Returns a credential to retry with, or null.
   *  Never throws. */
  async function renewCredentialOnce(stale: string): Promise<string | null> {
    if (!stale) return null;
    while (renewalInFlight) {
      await renewalInFlight.catch(() => null);
    }
    // A credential the server handed back on renewal, refused again: stop.
    if (stale === renewalRenewed) return null;
    if (renewalMemo && renewalMemo.from === stale && Date.now() < renewalMemo.until) {
      // Already renewed from (perhaps by the renewal this caller just waited
      // for), and not due again yet. Retry with its result, but only while it
      // is still the one held.
      const result = renewalProduced;
      return result && result !== stale && deleteToken === result
        ? result
        : null;
    }
    const misses = renewalMemo && renewalMemo.from === stale ? renewalMemo.misses : 0;
    // On the record BEFORE it is sent, so a refusal arriving meanwhile joins
    // this renewal instead of starting a second one — and with a short hold,
    // so a renewal that never comes back cannot hold for the whole page.
    renewalMemo = { from: stale, until: Date.now() + RENEWAL_UNANSWERED_MS, misses };
    const flight = (async (): Promise<string | null> => {
      let fresh: string | null = null;
      let fromServer = false;
      let answered = false;
      try {
        [fresh, fromServer, answered] = await renewCredentialFrom(stale);
      } catch {
        fresh = null;
        fromServer = false;
        answered = false;
      }
      renewalProduced = fresh && fresh !== stale ? fresh : null;
      if (renewalProduced && fromServer) renewalRenewed = renewalProduced;
      if (renewalMemo && renewalMemo.from === stale) {
        if (answered) {
          renewalMemo = { from: stale, until: Date.now() + RENEWAL_ANSWERED_MS, misses: 0 };
        } else {
          const missed = misses + 1;
          renewalMemo = {
            from: stale,
            until:
              Date.now() +
              Math.max(RENEWAL_UNANSWERED_MS, retryWaitMs(missed - 1)),
            misses: missed,
          };
        }
      }
      renewalInFlight = null;
      return renewalProduced;
    })();
    renewalInFlight = flight;
    return flight;
  }

  /** Replace a refused credential. Returns the credential now held (or null
   *  when nothing changed), whether the server itself handed it back, and
   *  whether the question was ANSWERED — a reply from Boosthis, or nothing
   *  to ask — as opposed to lost on the way. */
  async function renewCredentialFrom(
    stale: string,
  ): Promise<[string | null, boolean, boolean]> {
    if (isBoosthisDisabled()) return [null, false, false];
    // Nothing held means nothing was replaced: the refusal has another cause.
    const held = deleteToken;
    if (!held) return [null, false, true];
    // Already replaced (a registration reply landed meanwhile): that newer
    // credential is the answer, with no round trip.
    if (held !== stale) return [held, false, true];
    // No project key, nothing to ask with.
    if (!projectKey.key) return [null, false, true];
    const installId = activeInstallId;
    // The same registration call, made WITHOUT the held credential (presenting
    // the replaced one would be read as a proof attempt), so Boosthis answers
    // it as this known install reconnecting and hands its credential back.
    const outcome = await postConsentOutcome({
      allowRotation: false,
      withoutHeldCredential: true,
    });
    // Anything else moving meanwhile (a withdrawal, a forget) wins.
    if (activeInstallId !== installId) return [null, false, outcome.answered];
    const now = deleteToken;
    return now && now !== stale
      ? [now, true, outcome.answered]
      : [null, false, outcome.answered];
  }

  /** One upload, sent with the held credential — and, when Boosthis says
   *  another copy replaced that credential, renewed and sent once more. Hands
   *  back the answer the call site judges (the retry's when one ran) and the
   *  refusal fields of a credential refusal, read once, for the console line. */
  async function sendUpload(
    attempt: (credential: string) => Promise<Response>,
    keepalive: boolean,
  ): Promise<{ res: Response; refusal: RefusalBody | null }> {
    const held = deleteToken as string;
    const res = await attempt(held);
    if (isNoSendResponse(res)) return { res, refusal: null };
    const refusal = await readCredentialRefusal(res);
    if (keepalive || !isCredentialMismatch(res.status, refusal)) {
      return { res, refusal };
    }
    const fresh = await renewCredentialOnce(held);
    if (!fresh || fresh === held) return { res, refusal };
    const retried = await attempt(fresh);
    if (isNoSendResponse(retried)) return { res: retried, refusal: null };
    return { res: retried, refusal: await readCredentialRefusal(retried) };
  }

  /** Judge an upload's answer and, when Boosthis refused it, say which
   *  refusal on the console — once per page load and reason. */
  function judgeUpload(
    res: Response,
    refusal: RefusalBody | null,
    kind: PaceKind = "samples",
  ): boolean {
    const accepted = _noteUploadResponseForTests(res, kind);
    if (!accepted && !isNoSendResponse(res)) {
      noteUploadRefusedOnce(res.status, refusal);
    }
    return accepted;
  }

  // ─── SELF-HEALING REINSTALL RECOVERY (identity rotation) ──────────────────
  // A redeployed app (or one whose storage was cleared) keeps its host-baked
  // installId but loses its stored tokens, so its tokenless re-consent gets
  // the idempotent orphan response ("already_registered_no_token") forever.
  // Because a FRESH registration with a valid invite key is already permitted
  // (that is exactly what a brand-new install does), the kit recovers on its
  // own: mint a fresh random installId, persist the mapping in kit-owned
  // storage (keyed by the baked id so relaunches that re-pass the baked id
  // keep resolving to the rotated identity), and re-register under the new
  // identity. Server capability is UNCHANGED — no new endpoint, no weakened
  // proof rule; the old row's credentials stay dead and the row goes dormant.
  //
  // Guard rails (parity with the RN/Node kits):
  //   • fires ONLY on the orphan status, with an invite key in hand, and with
  //     no tokens (a Repair-window response carries tokens and takes the
  //     normal adoption path — rotation can never race an owner's Repair);
  //   • at most ONE rotation per session (no retry loops);
  //   • a persisted mapping is adopted only if it is UUID-shaped;
  //   • forget() erases the mapping (leave nothing Boosthis-shaped behind).
  // Web storage is synchronous, so the persisted mapping is adopted inline —
  // before the first network call, with no async gate needed.
  let activeInstallId = opts.installId;
  let rotatedThisSession = false;
  const rotationStoreKey = `rotatedInstallId:${opts.installId}`;
  if (freshAfterDissolved) {
    activeInstallId = generateRotationInstallId();
    rotatedThisSession = true;
    storage.set(rotationStoreKey, activeInstallId);
  }
  {
    const stored = storage.get(rotationStoreKey);
    if (
      typeof stored === "string" &&
      INSTALL_ID_SHAPE.test(stored) &&
      stored !== opts.installId
    ) {
      activeInstallId = stored;
    }
  }
  // The shared upload schedule (uploadPacing.ts) belongs to ONE install: a
  // record another install's pages wrote says nothing about this allowance.
  bindPaceInstall(activeInstallId);
  // THE PROJECT'S DETAILED CRASH SWITCH rides the registration answer, and a
  // returning visitor's browser holds a credential, so it does not register
  // on every page. The last answer is remembered for a day: within that day
  // it applies as given; after it, or with none, this browser asks once more
  // (one registration per browser per day at most, never a loop), so an owner
  // turning the switch off reaches every browser within a day. Old or
  // unreadable memory never turns detail on.
  const crashDetailsStoreKey = `crashDetails:${activeInstallId}`;
  try {
    const remembered = JSON.parse(storage.get(crashDetailsStoreKey) ?? "null");
    if (remembered && typeof remembered.at === "number" && Date.now() - remembered.at < CRASH_DETAILS_MEMORY_MS) {
      serverCrashDetails = remembered.on === true;
    } else if (wasRegisteredBefore(activeInstallId)) {
      scheduleConsentRetry(1_000);
    }
  } catch { /* Unreadable memory leaves detailed mode off. */ }

  /** (Re)install the server-authority kill-switch heartbeat for the CURRENT
   *  identity. startEntitlementCheckin captures installId by value, so every
   *  identity change (in-session rotation) must repoint it — otherwise the
   *  heartbeat knocks with the old id + the new token and the activation lock
   *  never releases. `getToken` is lazy so the token minted by consent (read
   *  OR delete) is picked up on the next check. This is the VAULT contract's
   *  on-launch enforcement edge: the first check runs a FORCED launch check-in
   *  (bypassing any cache-satisfied fast path). Web storage is synchronous, so
   *  the persisted-rotation mapping is already adopted above — no async gate. */
  function installCheckinConfig(): void {
    startEntitlementCheckin({
      endpoint,
      installId: activeInstallId,
      getToken: () => deleteToken ?? readToken,
      integrity: null,
      fetchImpl: fetchOptions.fetchImpl,
      // A check-in refused because another copy replaced the credential
      // renews through the same single renewal the upload paths share.
      renewCredential: (stale) => renewCredentialOnce(stale),
      // The owner pressed Reconnect: one consent call, so the directives this
      // page holds match the server's answer again. Chased like any consent
      // that got no usable answer (docs/kit-call-recovery.md).
      onReconnected: () => {
        if (!enabled || isBoosthisDisabled()) return;
        void postConsent().catch(() => {
          // postConsent only throws on PII-guard bugs; never crash the host.
        });
      },
    });
  }

  /** Register, and be countable while it is happening. Every caller goes
   *  through here, so a withdrawal always knows what is outstanding. */
  async function postConsent(consentOpts?: {
    /** Whether the orphan answer may mint a FRESH identity (see the
     *  self-healing block below). True everywhere except a deliberate
     *  credential renewal, which is repairing ONE known install and must
     *  never turn a refused credential into a second install. */
    allowRotation?: boolean;
    /** Ask WITHOUT presenting the held credential. Only a renewal does: the
     *  replaced credential would be read as a proof attempt. The credential
     *  stays held meanwhile, so nothing else registers underneath it. */
    withoutHeldCredential?: boolean;
    /** The lazy registration an upload path makes first. Held back while a
     *  refused registration waits for its hourly retry. */
    onDemand?: boolean;
  }): Promise<number> {
    return (await postConsentOutcome(consentOpts)).status;
  }

  /** {@link postConsent}, also saying whether Boosthis ANSWERED. */
  async function postConsentOutcome(consentOpts?: {
    allowRotation?: boolean;
    withoutHeldCredential?: boolean;
    onDemand?: boolean;
  }): Promise<ConsentOutcome> {
    if (isDissolvedThisRun() || !claimRestartRegistration()) return { status: 0, answered: false };
    if (consentOpts?.onDemand && Date.now() < consentSuppressedUntil) {
      return { status: 0, answered: false };
    }
    registrationAskedThisPage = true;
    const flight = askServerToRegister(consentOpts);
    registrationsInFlight.add(flight);
    try {
      return await flight;
    } finally {
      registrationsInFlight.delete(flight);
      launchConsentAnswered = true;
    }
  }

  async function askServerToRegister(consentOpts?: {
    allowRotation?: boolean;
    withoutHeldCredential?: boolean;
  }): Promise<ConsentOutcome> {
    // The permission this registration was made under. Re-read after the
    // round trip: a reply that crosses a withdrawal is not ours to adopt.
    const generation = withdrawalGeneration;
    // UNDER A STATED WAIT. Boosthis asked this install to wait (a 429 on any
    // request, from any tab): registering now would spend the allowance the
    // wait protects, and every upload path that registers lazily would do it
    // again underneath the wait. Hold, say "throttled", ask once it is over.
    const heldUntil = pausedUntil();
    if (heldUntil !== null) {
      markRegistrationThrottled();
      scheduleConsentRetry(Math.max(1_000, heldUntil - Date.now() + 250));
      return { status: 0, answered: false };
    }
    let res: Response;
    const displayName = resolveAppName(opts.appName);
    // Whether this call PRESENTS a credential. One that does is asking about
    // an install already on file (the owner's switches ride the answer); one
    // that does not is a registration, which counts only once a credential
    // has been read from the reply.
    const presentsCredential =
      !!deleteToken && !consentOpts?.withoutHeldCredential;
    // An attempt is now on the record BEFORE it is made, so the watch that
    // reconciles the startup line can tell "we asked and heard nothing" from
    // "we never asked" — the two states this bug used to blur into one.
    noteRegistrationAttemptStarted();
    try {
      res = await _gatedTransmitInternal(
        `${endpoint}/installs/consent`,
        {
          installId: activeInstallId,
          runtime: "web",
          packageVersion: RUNTIME_VERSION,
          // THE SITE'S OWN RELEASE, only when the page declared one through
          // the `packageVersion` option. It travels in its own block, marked as
          // declared, and is never sent in place of the kit's version above.
          // A page that declared nothing sends no block at all.
          ...declaredAppVersionBlock(opts.packageVersion),
          // WHAT THIS BUILD'S CODE ASKED FOR — never what is in effect. The
          // server's own switch still wins in both directions and nothing here
          // changes that; sending this is what lets the owner's page show the
          // two answers side by side, instead of describing a code setting it
          // has never been told. See lib/telemetry-mode-contract.json.
          telemetryMode: issuesOnly ? "reduced" : "full",
          ...(displayName ? { appName: displayName } : {}),
          // The ONE word a development page declares about itself — never the
          // address or port that made it one. Absent on every other page, so
          // the server's environment column stays "this kit never told us".
          ...(pageEnvironment ? { hosting: { environment: pageEnvironment } } : {}),
        },
        // Consent is the step that LEADS to activation, so it must be allowed
        // to send while the kit is merely LOCKED (never handshaken). A KILLED
        // install (revoked / unpaid / grace-expired) is still silenced.
        { ...fetchOptions, allowWhenLocked: true },
        projectKey.key ? `Bearer ${projectKey.key}` : undefined,
        // Proof of control for the one-time read-token backfill: the
        // Authorization header carries the invite key, so the delete token
        // rides in this dedicated internal header (applied AFTER the PII
        // guard). Omitted on first consent — the fresh-register path mints
        // the read token unconditionally — and on a renewal, which is asking
        // precisely because this credential was replaced.
        deleteToken && !consentOpts?.withoutHeldCredential
          ? { "X-Boosthis-Install-Token": deleteToken }
          : undefined,
      );
    } catch {
      noteRegistrationAttemptEnded();
      // Network/transport failures return 0 instead of propagating. PII
      // failures still propagate — they indicate a programming bug. A thrown
      // transport (DNS, TLS, a broken certificate store, a blocking proxy)
      // means the kit could not reach the API at all: say so ONCE. This is the
      // silent-failure case that cost a real install ~19 minutes. Traffic-
      // driven consent will keep retrying; the one-shot guard keeps it quiet.
      warnStayedInactiveOnce("network");
      // We could not ask, so we do not know. "Cannot tell right now" — never a
      // failed install (the panel used to render this as "not registered").
      markRegistrationUnreachable();
      noteRegistrationTrouble();
      // …and come back to it. A tab that opened offline must register when it
      // can, rather than staying dark until something else happens to trigger
      // a consent.
      scheduleConsentChase();
      return { status: 0, answered: false };
    }
    noteRegistrationAttemptEnded();
    // NOTHING WAS SENT.
    //
    // When the kill-switch or the activation lock silences this POST, the
    // transmit helper still has to return a Response, so it invents a 204 — and
    // a 204 is `ok`. Every branch below therefore used to read a request that
    // never left the browser as a registration the SERVER had accepted, and
    // `markRegistrationConfirmed()` published that as fact to the panel, the
    // status readout and the kit's own claim about itself. A false green is
    // worse than the silence it hid: it cannot even be re-tested honestly.
    //
    // A locally-invented answer says nothing about the server, so it gets its
    // own honest state and no confirmation at all.
    if (isNoSendResponse(res)) {
      noteRegistrationNotSent({ silent: isBoosthisDisabled() });
      return { status: 0, answered: false };
    }
    // THE PERMISSION MOVED WHILE WE WERE ASKING.
    //
    // Everything below this point adopts: a credential, a registered mark on
    // the device, a server directive about what to share. None of it may
    // happen for a visitor who has since said no — that is an install
    // re-established after its owner asked for it to be gone. The one thing
    // worth keeping is the delete token the server just minted, because it is
    // the only thing that can erase what this very request created; the
    // withdrawal is waiting for us and will use it.
    // Acceptance is deliberately NOT judged here: this path adopts nothing,
    // so it has no verdict to reach, and the kit keeps exactly two places
    // that read a reply as accepted. A locally-invented no-send 204 cannot
    // reach this line — it returned above — and a refusal carries no token,
    // so taking whatever token the body holds is the whole job.
    if (withdrawalGeneration !== generation) {
      try {
        const body = (await readAnswerJson(res)) as { deleteToken?: unknown } | null;
        if (typeof body?.deleteToken === "string" && body.deleteToken) {
          tokenIssuedAfterWithdrawal = body.deleteToken;
        }
      } catch {
        // A reply we cannot read leaves nothing to erase with. The install
        // the withdrawal already held a token for is still erased below.
      }
      return { status: 0, answered: false };
    }
    // Whether Boosthis ANSWERED, set per branch below. Starts false: a branch
    // that forgets to decide is retried rather than believed.
    let answered = false;
    // A 2xx is not yet an answer. Read it FIRST.
    //
    // A Wi-Fi login page, a proxy's page and an empty reply all arrive as 2xx.
    // This branch used to confirm the install — in memory AND in this
    // browser's storage — before reading a byte, so such a reply left the tab
    // holding a "registered" mark with no credential behind it, and with
    // nothing left to retry: a 2xx stopped the chase. Now a reply counts only
    // when it is a JSON object and, for a registration (no credential
    // presented), carries a credential or the orphan answer.
    type ConsentReply = {
      deleteToken?: unknown;
      readToken?: unknown;
      shareMeterWithAI?: unknown;
      fullTelemetry?: unknown;
      crashDetails?: unknown;
      status?: unknown;
      projectName?: unknown;
      projectCode?: unknown;
    };
    let okBody: ConsentReply | null = null;
    let okReadable = false;
    // The one place this path reads the reply as accepted, after the no-send
    // check above (a guard counts the reads).
    const replyOk = res.ok;
    if (replyOk) {
      try {
        const parsed: unknown = await readAnswerJson(res);
        if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
          okBody = parsed as ConsentReply;
          okReadable = true;
        }
      } catch {
        okReadable = false;
      }
    }
    if (isDissolvedThisRun()) return { status: 0, answered: false };
    const okIsAnswer =
      okReadable &&
      (presentsCredential ||
        (typeof okBody?.deleteToken === "string" && okBody.deleteToken !== "") ||
        okBody?.status === "already_registered_no_token");
    if (replyOk && !okIsAnswer) {
      // Not Boosthis, or not a registration: we do not know whether this
      // install is on file. Exactly what a transport failure means — say so
      // the way that path does (once), keep NO registered mark anywhere, and
      // come back to it on the ladder. A renewal is retried by its own memo,
      // from the next refused request, so it arms nothing here.
      if (!okReadable) warnStayedInactiveOnce("network");
      markRegistrationUnreachable();
      noteRegistrationTrouble();
      if (!consentOpts?.withoutHeldCredential) scheduleConsentChase();
    } else if (replyOk) {
      answered = true;
      // Registration accepted — cancel any pending rejected-registration
      // retry so the timer never fires a redundant consent, and let the
      // upload paths ask again whenever they need to.
      stopConsentRetry();
      consentSuppressedUntil = 0;
      // A registration the server ACCEPTED proves the install id is valid, so
      // discard any earlier invalid-install-id rejected state (a developer who
      // saw the rejection, minted a real UUID, and re-registered on the same
      // page must get the normal dashboard back, not a stale rejection).
      installIdRejected = false;
      // An accepted consent is the server telling us this install IS on file —
      // the strongest possible answer to the panel's registration question, and
      // one that outlives whatever this browser happens to have stored.
      markRegistrationConfirmed();
      // …and write that down where it outlives the page. Registration is
      // durable server-side; every local surface described ONE page load, so
      // a reload of a healthy install started again from "announced, never
      // asked" and presented a days-old success as a fresh failure.
      rememberRegistered(activeInstallId);
      // The startup line promised this. Say so if the promise had already been
      // broken once — a developer who read the failure line must be told when
      // it clears, or a tab that started offline looks broken forever.
      noteRegistrationConfirmed();
      try {
        // Already read and judged above: a JSON object.
        const body = okBody;
        // The project's switch, both edges: an answer without it (an older
        // server) reads as off, never as "keep what we had".
        serverCrashDetails = body?.crashDetails === true;
        storage.set(crashDetailsStoreKey, JSON.stringify({ on: serverCrashDetails, at: Date.now() }));
        // Applied now only while the kit may measure. A registration answered
        // while locked (or before the first active answer) must not put the
        // crash listeners back: the lock rule removed them, and the reinstall
        // on the next active answer reads serverCrashDetails itself.
        if (!isRuntimeInert()) {
          installCrashHandlers({ detailed: opts.crashDetails === true || serverCrashDetails, subscribeEntitlement });
        }
        // WHICH PROJECT this key belongs to. The developer-authored name is
        // re-sanitised by projectIdentity, persisted, and rendered as text only.
        // Older servers omit both fields, which must leave known state intact.
        if (body?.projectName != null || body?.projectCode != null) {
          setKitProject(body.projectName, body.projectCode);
          try {
            storage.set(
              projectStoreKey,
              serializeKitProject(getKitProject()),
            );
          } catch {
            // Best-effort: the next consent reply can restore display state.
          }
        }
        // Adopt any server-issued delete token and — critically — notify the
        // host whenever the VALUE changes, not just the first time one is
        // issued. A page can come back holding a STALE persisted token
        // (storage restored from an older copy, or a regenerated installId
        // with old storage kept); the server then mints fresh credentials
        // (fresh registration, or an owner-approved repair re-issue). If the
        // host is only told on first issuance, it keeps re-persisting the
        // stale token and every reload is broken again — so fire on change.
        const issued =
          typeof body?.deleteToken === "string" ? body.deleteToken : null;
        if (issued) {
          const changed = issued !== deleteToken;
          deleteToken = issued;
          if (changed) kitMicrotask(() => { void offerCrashes(); });
          if (changed) opts.onTokenIssued?.(issued);
        }
        const readIssued =
          typeof body?.readToken === "string" ? body.readToken : null;
        if (readIssued) {
          const changed = readIssued !== readToken;
          readToken = readIssued;
          storage.set(readTokenStoreKey, readIssued);
          if (changed) opts.onReadTokenIssued?.(readIssued);
        }
        // Server directive: the developer connected an AI from the web
        // dashboard, so auto-enable the PII-filtered snapshot mirror (even in
        // issues-only mode). Rising-edge only — it never turns the mirror off
        // and never touches the sample firehose.
        if (body?.shareMeterWithAI === true && !serverShareMeterWithAI) {
          serverShareMeterWithAI = true;
          syncSnapshotUpload();
        }
        // Dashboard "Full telemetry" directive — BOTH edges (parity with
        // Node/RN). ON forces full mode for the session; OFF forces issues-only
        // for the session. The first boolean the server sends flips the
        // three-state `serverFullTelemetry` off its initial null, so from then
        // on the server wins in BOTH directions. Only wires the snapshot mirror
        // on/off here; the per-page sample firehose is gated live via
        // effectiveIssuesOnly() in onRecordedSample()/transmit(). Never
        // resurrects a disabled runtime — syncSnapshotUpload() self-guards on
        // enabled + kill-switch.
        if (
          typeof body?.fullTelemetry === "boolean" &&
          body.fullTelemetry !== serverFullTelemetry
        ) {
          serverFullTelemetry = body.fullTelemetry;
          syncSampleObserver();
          syncSnapshotUpload();
        }
        // Both answers are known here for the first time — outside the block
        // above, so a response that merely REPEATS a directive we already hold
        // still gets the developer told. The helper self-guards on the
        // pre-contact state and says it once.
        noteTelemetryModeContradiction();
        // SELF-HEALING: the server says this install id is registered but we
        // hold no proof (orphaned identity — a redeploy/storage wipe lost the
        // stored tokens). If we have an invite key and this response carried
        // NO tokens (a Repair-window response carries tokens and was adopted
        // above — never rotate over a Repair), mint a FRESH identity and
        // re-register under it. Once per session, mapping persisted so every
        // later launch resolves the baked id to the rotated identity.
        if (
          body?.status === "already_registered_no_token" &&
          !deleteToken &&
          !readToken &&
          projectKey.key &&
          !rotatedThisSession &&
          consentOpts?.allowRotation !== false
        ) {
          rotatedThisSession = true;
          const rotated = generateRotationInstallId();
          // Best-effort persistence — storage.set degrades to memory itself,
          // so a blocked store means a session-only rotation, never a throw.
          storage.set(rotationStoreKey, rotated);
          activeInstallId = rotated;
          bindPaceInstall(activeInstallId);
          // Keep the persisted "installId" (used by the Node-side MCP
          // entrypoint) pointing at the identity that actually owns the data.
          storage.set("installId", rotated);
          // Repoint the server-authority kill-switch heartbeat at the rotated
          // identity so it knocks with the id that actually owns the data (and
          // the new token) — otherwise the activation lock would never release.
          installCheckinConfig();
          // Re-register under the fresh identity — this is a normal fresh
          // registration and mints fresh credentials via the standard path,
          // chased on the same ladder if it gets no usable answer.
          return postConsentOutcome();
        }
        if (body?.status === "already_registered_no_token" && !deleteToken) {
          // The orphan marker rode in on an HTTP 200, so the success branch
          // would otherwise walk straight past it: the install looks connected,
          // uploads nothing, and says nothing. Self-heal already tried (or
          // could not — no invite key, or already rotated once this page) and
          // the answer is still the orphan marker, so this is NOT a working
          // registration. Say it once and stop; never loop.
          setRegistrationRefusalKind("orphan");
          warnStayedInactiveOnce("orphan");
          // No credential came back, so every upload path would ask again on
          // its next flush and be told the same. Ask once an hour instead —
          // an owner's repair on the dashboard is what changes this answer.
          consentSuppressedUntil = Date.now() + consentRetryMs;
          scheduleConsentRetry();
        }
      } catch {
        // ignore malformed body — server health is the source of truth
      }
      // Consent succeeded and (typically) minted a token, so the kit can now
      // learn its true entitlement — a revoked / unpaid verdict must land
      // immediately (and release the activation lock for an active project)
      // without waiting for the 6h heartbeat.
      //
      // This used to force a check unconditionally, which meant a returning
      // visitor asked the SAME question twice on every launch: once when the
      // heartbeat started with the credential already in storage, and again
      // here. Now it asks only when the question is new — which is exactly the
      // first-ever visitor, whose launch check had no credential to ask with,
      // and an identity rotation, which mints a fresh pair.
      ensureEntitlementChecked();
      // …and if that first answer does not confirm the install (the server can
      // legitimately still be finishing the registration behind it), keep
      // asking on a short ladder. Without it a correct install stayed dark,
      // and invisible, until the next launch — 22 minutes on the project that
      // reported it.
      chaseFirstActivation();
    } else if (res.status === 400) {
      answered = true;
      // The server validates `install_id` as a UUID v4 and answers 400 with a
      // fixed `invalid_install_id` marker when it is not. Record the rejected
      // state + print one code-defined line; do NOT arm the hourly retry (the
      // id cannot change by itself, so retrying can never succeed). Any other
      // 400 falls through untouched.
      await handleInvalidInstallIdOnce(res);
      // A refused id is a definite negative: nothing is on file under it.
      markRegistrationRefused();
      // Explained already, in that path's own fixed sentence — so the watch
      // must close the promise quietly rather than add a second, vaguer line.
      noteRegistrationExplained();
    } else if (res.status === 401 || res.status === 403) {
      answered = true;
      // Registration was rejected (bad/revoked invite key). The Web runtime
      // has no locked-screen UI, so surface a one-time plain-English hint —
      // then keep quietly knocking once an hour so a key fixed server-side
      // (rekey / rotation) brings this app back without a page reload. An
      // `invite_key_revoked` marker in the body sharpens the wording.
      //
      // The marker splits three situations that used to be one shrug, and that
      // need opposite actions: a revoked key is dead forever, a paused one
      // needs no code change at all, and an unrecognised one usually means the
      // key the developer meant is still fine and simply mistyped. Only the
      // fixed marker is read — never the server's prose.
      let kind: RegistrationFailure = "key";
      try {
        const body = (await readAnswerJson(res.clone())) as { error?: unknown } | null;
        const marker = body?.error;
        // A closing account is told apart from a billing problem: the two
        // are settled by different people doing different things.
        kind =
          marker === "invite_key_revoked"
            ? "revoked"
            : marker === "plan_required"
              ? "paused"
              : marker === "account_closure_pending"
                ? "closing"
                : marker === "invite_key_unknown"
                  ? "unknown"
                  : "key";
      } catch {
        // Non-JSON body — fall back to the generic "not accepted" wording.
      }
      setRegistrationRefusalKind(kind);
      warnStayedInactiveOnce(kind);
      // The key was refused, so this app genuinely cannot register under it —
      // a definite negative, and the one case where the gate's no-lockout
      // escape hatch is meant to open.
      markRegistrationRefused();
      noteRegistrationTrouble();
      // Until the hourly retry, the upload paths do not ask again: nothing
      // changes this answer but somebody acting on the dashboard.
      consentSuppressedUntil = Date.now() + consentRetryMs;
      scheduleConsentRetry();
    } else if (res.status === 429) {
      // Asked to wait, with the wait stated (the registration limiter always
      // sends Retry-After). Not "unreachable" and not a refusal: record the
      // wait for every path in every tab and ask again once it is over.
      const until = holdForStatedWait("register", retryAfterOf(res));
      markRegistrationThrottled();
      scheduleConsentRetry(Math.max(1_000, until - Date.now() + 250));
    } else {
      // A definite 4xx is an answer (still chased below, as it always was); a
      // 404 from routing, a 408 and a 5xx are not.
      answered =
        res.status >= 400 &&
        res.status < 500 &&
        res.status !== 404 &&
        res.status !== 408;
      // Any other non-ok answer (5xx, an unexpected 4xx) is still a
      // registration that did not go through — a kit that says nothing here is
      // indistinguishable from a healthy one. Name the coarse reason once.
      warnStayedInactiveOnce("other", res.status);
      // A server error is not an answer about our records: cannot tell.
      markRegistrationUnreachable();
      noteRegistrationTrouble();
      // A 5xx clears on its own once the server recovers — but only for a page
      // that asks again. (A fresh 400 for a non-UUID id is handled above and
      // deliberately never reaches this ladder: it can never succeed.)
      scheduleConsentChase();
    }
    // NO KEY, SAID LAST — but always said.
    //
    // The keyless state is known the instant enableTelemetry runs (and the
    // panel and status readout show it from that moment). The CONSOLE line
    // waits until the round trip has settled, for one reason: a specific fault
    // beats a general one. A keyless page that also cannot reach us, or whose
    // install id belongs to another copy, has a sharper problem worth the one
    // line it gets. The latch inside warnStayedInactiveOnce makes this a no-op
    // whenever anything above already spoke — so exactly one line is printed
    // either way, and a keyless page is never silent.
    warnNoProjectKeyIfStillUnexplained();
    return { status: res.status, answered };
  }

  /** Say the keyless state on the console, unless a sharper reason already
   *  claimed this page's one line. Never throws. */
  function warnNoProjectKeyIfStillUnexplained(): void {
    try {
      if (projectKey.key) return;
      warnStayedInactiveOnce(
        projectKey.declined ? "no-key-chosen" : "no-key-missing",
      );
    } catch {
      /* evidence never blocks reporting */
    }
  }

  /** Whether the PII-filtered snapshot mirror may upload right now. True in
   *  full mode; in issues-only mode only with the explicit `shareMeterWithAI`
   *  opt-in OR the server directive. Always off when disabled or killed. */
  function effectiveSnapshotUploadAllowed(): boolean {
    if (!enabled || isBoosthisDisabled()) return false;
    return (
      !effectiveIssuesOnly() ||
      explicitShareMeterWithAI ||
      serverShareMeterWithAI
    );
  }

  /** Wire (or unwire) the per-page sample firehose to the CURRENT effective
   *  mode. Wired only in full mode (code config OR the server "Full telemetry"
   *  grant), never when disabled/killed. Idempotent: re-wiring the same
   *  observer is a no-op. Lets the dashboard directive flip the firehose on/off
   *  in-session without a relaunch. Mirrors Node's setSampleQueueIssuesOnly. */
  function syncSampleObserver(): void {
    if (!effectiveIssuesOnly() && enabled && !isRuntimeInert()) {
      setSampleObserver(onRecordedSample);
      wirePagehideFlush();
      // Samples a closing page of this browser handed over go out with this
      // page's next send, even if this page records none of its own.
      if (handedOverCount() > 0) scheduleSampleFlush();
    } else {
      setSampleObserver(null);
      unwirePagehideFlush();
      sampleQueue = [];
      if (sampleTimer !== null) {
        clearTimeout(sampleTimer);
        sampleTimer = null;
      }
    }
  }

  /** Single source of truth for wiring the snapshot submitter + auto-upload
   *  timer. Clearing the submitter (not just stopping the timer) matters
   *  because a manual flush calls the submitter directly. */
  function syncSnapshotUpload(): void {
    if (!isRuntimeInert() && effectiveSnapshotUploadAllowed()) {
      // The snapshot module asks only once a captured summary holds data.
      setSnapshotSubmitter((snap, o) => client.transmitSnapshot(snap, o), () => holdForUploadStart(true));
      startSnapshotAutoUpload();
      // The 60s cadence alone loses every visit shorter than a minute — the
      // common case on a plain multi-page site — so the snapshot also
      // exit-flushes on pagehide with keepalive, exactly like the sample
      // queue. Rides the same allow-gate: wired only while sharing is on.
      wireSnapshotPagehideFlush();
      // Trace spans carry code-defined route labels too, so they share the
      // exact same allow-gate as the snapshot mirror: nothing span-shaped is
      // retained or shipped on a private app until sharing is authorized.
      // The emitter asks only when its buffer holds spans.
      setSpanSubmitter((spans) => client.transmitSpans(spans), () => holdForUploadStart(true));
      startSpanAutoFlush();
    } else {
      setSnapshotSubmitter(null);
      stopSnapshotAutoUpload();
      unwireSnapshotPagehideFlush();
      setSpanSubmitter(null);
      stopSpanAutoFlush();
    }
  }

  // Exit flush for the snapshot mirror. uploadPerfSnapshotNow() re-checks the
  // submitter (cleared by syncSnapshotUpload when sharing turns off) and skips
  // data-free pages, so a late pagehide can never leak a snapshot or ship an
  // empty one. keepalive lets the request outlive the dying document.
  //
  // ONE SNAPSHOT PER INTERVAL PER INSTALL. The server keeps only the latest
  // snapshot for an install, so a closing page whose browser sent one within
  // the last few seconds (a quick reload), or whose install the server says
  // has enough snapshots for now (many visitors), would spend a request of
  // the shared allowance for nothing. Under a pause nothing is sent at all.
  const snapshotPagehideFlush = (): void => {
    const now = Date.now();
    if (pausedUntil(now) !== null) return;
    // Only where the record outlives this page: without it the next page
    // cannot know a snapshot just went, so this one still sends (as before).
    const last = lastSentAt("snapshot");
    if (mayHandOver() && last !== null && now - last < SNAPSHOT_EXIT_SKIP_MS) return;
    const hint = snapshotHintAt();
    if (hint !== null && hint > now) return;
    void uploadPerfSnapshotNow({ keepalive: true });
  };
  function wireSnapshotPagehideFlush(): void {
    try {
      if (typeof addEventListener === "function") {
        // Idempotent: re-adding the same function reference is a no-op per
        // the DOM addEventListener contract, so repeated sync calls are safe.
        outsideAngular(() => addEventListener("pagehide", snapshotPagehideFlush));
      }
    } catch {
      // non-browser context — the cadence timer still flushes
    }
  }
  function unwireSnapshotPagehideFlush(): void {
    try {
      if (typeof removeEventListener === "function") {
        removeEventListener("pagehide", snapshotPagehideFlush);
      }
    } catch {
      // ignore
    }
  }

  // ---- full-sample upload queue (full mode only) ---------------------------
  // The vitals engine records one sample per page view; the observer batches
  // them and flushes on a cadence + on pagehide so a tab close doesn't drop
  // the last page. Issues-only mode never registers the queue.
  let sampleQueue: TelemetrySample[] = [];
  let sampleTimer: ReturnType<typeof setTimeout> | null = null;

  /** ONE SAMPLE SCHEDULE PER BROWSER. Every tab and every reload uploads
   *  against the same install allowance, so a flush first asks the shared
   *  record (uploadPacing.ts) whether this browser sent samples within the
   *  last {@link SAMPLE_MIN_GAP_MS}. If it did — another tab, or the page
   *  this one replaced — this tab hands its queue to the next send instead
   *  of making a request of its own, and whichever tab is granted next sends
   *  everything in one upload. A little under the cadence, so a lone tab's
   *  own timer is always granted. */
  const SAMPLE_MIN_GAP_MS = SAMPLE_FLUSH_MS - 5_000;
  /** One stable reference, so a page waiting out a pause flushes once. */
  const flushAfterPause = (): void => flushSampleQueue();

  function flushSampleQueue(keepalive = false): void {
    if (sampleTimer !== null) {
      clearTimeout(sampleTimer);
      sampleTimer = null;
    }
    // The exit flush never waits: no later pass exists, and its own send
    // registers first, as it always did.
    if (!keepalive && holdForUploadStart(sampleQueue.length > 0 || handedOverCount() > 0)) {
      if (sampleQueue.length > MAX_SAMPLE_BATCH) {
        noteHeldDropped(sampleQueue.length - MAX_SAMPLE_BATCH);
        sampleQueue = sampleQueue.slice(-MAX_SAMPLE_BATCH);
      }
      if (sampleQueue.length || handedOverCount()) scheduleSampleFlush();
      return;
    }
    if (keepalive) {
      closeSampleQueue();
      return;
    }
    if (sampleQueue.length === 0 && handedOverCount() === 0) return;
    // A FULL upload goes now, as it always did: it is the most a request can
    // carry, so waiting would only grow the queue. Only a wait holds it.
    if (sampleQueue.length >= MAX_SAMPLE_BATCH && pausedUntil() === null) {
      noteSent("samples");
      const full = sampleQueue;
      sampleQueue = [];
      sendSamples(full);
      return;
    }
    const claim = claimSend("samples", SAMPLE_MIN_GAP_MS);
    if (!claim.ok) {
      if (sampleQueue.length > 0 && mayHandOver()) {
        handOverSamples(sampleQueue);
        sampleQueue = [];
      } else if (sampleQueue.length > MAX_SAMPLE_BATCH) {
        // Held under a wait with nowhere durable to keep it: one upload's
        // worth stays (the newest), the rest is the kit's own counted drop.
        noteHeldDropped(sampleQueue.length - MAX_SAMPLE_BATCH);
        sampleQueue = sampleQueue.slice(-MAX_SAMPLE_BATCH);
      }
      if (pausedUntil() !== null) whenPauseEnds(flushAfterPause);
      else scheduleSampleFlush(Math.max(1_000, claim.at - Date.now()));
      return;
    }
    sendSamples([
      ...(takeHandedOverSamples() as TelemetrySample[]),
      ...sampleQueue,
    ]);
    sampleQueue = [];
  }

  /** Send up to one upload's worth now; the rest waits for the next send. */
  function sendSamples(all: TelemetrySample[], keepalive = false): void {
    if (all.length === 0) return;
    const batch = all.slice(0, MAX_SAMPLE_BATCH);
    const rest = all.slice(MAX_SAMPLE_BATCH);
    if (rest.length > 0) holdSamples(rest, false);
    void client.transmit(batch, keepalive ? { keepalive: true } : undefined);
  }

  /** Keep samples a send could not take (asked to wait, or past one
   *  upload's worth) for the next permitted upload: in the shared hand-over
   *  when it outlives the page, else at the head of this page's queue,
   *  within one upload's worth. What does not fit is counted as dropped by
   *  the kit itself — never as a batch Boosthis refused. */
  function holdSamples(held: TelemetrySample[], waitForPause = true): void {
    // A lock or an erase that landed while the batch was on the wire keeps it
    // dropped: nothing measured before a lock is held for later.
    if (held.length === 0 || isRuntimeInert()) return;
    if (mayHandOver()) {
      returnSamples(held);
    } else {
      const all = [...held, ...sampleQueue];
      const over = Math.max(0, all.length - MAX_SAMPLE_BATCH);
      if (over > 0) noteHeldDropped(over);
      sampleQueue = all.slice(0, MAX_SAMPLE_BATCH);
    }
    if (waitForPause && pausedUntil() !== null) {
      whenPauseEnds(flushAfterPause);
    } else {
      scheduleSampleFlush();
    }
  }

  /** The page is going away. Samples sent by this browser within the last
   *  cadence, or a wait in force, mean another request now would spend the
   *  allowance for little: the queue is handed to the next send instead —
   *  when the hand-over outlives the page. Otherwise this is today's last
   *  send on the way out (keepalive), or, under a wait with nowhere to keep
   *  the data, a drop the kit counts as its own. */
  function closeSampleQueue(): void {
    const paused = pausedUntil() !== null;
    const last = lastSentAt("samples");
    const recent = last !== null && Date.now() - last < SAMPLE_FLUSH_MS;
    if (mayHandOver()) {
      if (paused || recent) {
        handOverSamples(sampleQueue);
        sampleQueue = [];
        return;
      }
      if (sampleQueue.length === 0 && handedOverCount() === 0) return;
      noteSent("samples");
      sendSamples(
        [...(takeHandedOverSamples() as TelemetrySample[]), ...sampleQueue],
        true,
      );
      sampleQueue = [];
      return;
    }
    if (sampleQueue.length === 0) return;
    if (paused) {
      noteHeldDropped(sampleQueue.length);
      sampleQueue = [];
      return;
    }
    const batch = sampleQueue;
    sampleQueue = [];
    void client.transmit(batch, { keepalive: true });
  }

  function scheduleSampleFlush(afterMs: number = SAMPLE_FLUSH_MS): void {
    if (sampleTimer !== null) return;
    sampleTimer = kitTimeout(() => {
      sampleTimer = null;
      try { flushSampleQueue(); }
      catch { if (sampleQueue.length || handedOverCount()) scheduleSampleFlush(); }
    }, afterMs);
    // In a Node context (tests, SSR) never keep the process alive.
    const t = sampleTimer as { unref?: () => void };
    if (typeof t.unref === "function") t.unref();
  }

  function onRecordedSample(s: Sample): void {
    if (effectiveIssuesOnly() || !enabled || isBoosthisDisabled()) return;
    // ONE INSTALL, MANY VISITORS. Above a stated load the server asks for
    // samples from a share of visits; this visit (shared by its tabs and
    // reloads) was chosen once, at random. The dashboard and the assistant
    // say "measured from about 1 in N visits" wherever these readings show.
    if (!visitMeasured()) return;
    const metadata = wireSampleMetadata({
      timing: s.timing,
      opened: s.opened,
      naming: s.naming,
    });
    sampleQueue.push({
      routeLabel: s.name,
      durationMs: s.duration_ms,
      rating: s.rating,
      ...(metadata ? { metadata } : {}),
    });
    if (sampleQueue.length >= MAX_SAMPLE_BATCH) {
      flushSampleQueue();
      return;
    }
    scheduleSampleFlush();
  }

  const pagehideFlush = (): void => {
    flushSampleQueue(true);
  };
  function wirePagehideFlush(): void {
    try {
      if (typeof addEventListener === "function") {
        outsideAngular(() => addEventListener("pagehide", pagehideFlush));
      }
    } catch {
      // non-browser context — the cadence timer still flushes
    }
  }
  function unwirePagehideFlush(): void {
    try {
      if (typeof removeEventListener === "function") {
        removeEventListener("pagehide", pagehideFlush);
      }
    } catch {
      // ignore
    }
  }

  const client: TelemetryClient = {
    get installId() {
      return activeInstallId;
    },
    get endpoint() {
      return endpoint;
    },
    get enabled() {
      return enabled && !isBoosthisDisabled();
    },
    get deleteToken() {
      return deleteToken;
    },
    get readToken() {
      return readToken;
    },
    get projectKey() {
      return projectKey;
    },
    get fullTelemetryEffective() {
      // The mode uploads actually run under right now: !effectiveIssuesOnly()
      // is full mode (code config OR the server "Full telemetry" grant).
      return !effectiveIssuesOnly();
    },
    get meterSharing() {
      // The sharing CHOICE, independent of the transient kill/disable state:
      // full mode OR the shareMeterWithAI opt-in (explicit or server).
      return (
        !effectiveIssuesOnly() ||
        explicitShareMeterWithAI ||
        serverShareMeterWithAI
      );
    },

    async consent() {
      if (isDissolvedThisRun()) return 0;
      if (!enabled || isBoosthisDisabled()) {
        // Returning zero here — after the startup line has already promised a
        // registration — is one of the paths that produced the reported
        // silence. Nothing is sent, so nothing may be claimed: record the
        // honest state. The env kill-switch stays SILENT on the console
        // because the startup line's own badge clause already said the kit is
        // switched off; contradicting it would be worse than saying nothing.
        noteRegistrationNotSent({ silent: isBoosthisDisabled() });
        return 0;
      }
      return postConsent();
    },

    async renewCredential(refused) {
      if (!enabled || isBoosthisDisabled()) return null;
      // Nothing held = nothing was replaced. Re-consenting here would only add
      // a round trip to a refusal whose cause lies elsewhere.
      if (!deleteToken) return null;
      // The SAME renewal the upload paths and the check-in use: it asks
      // without presenting the dead credential, keeps the page exactly as it
      // was when no credential (or the same one) comes back, and answers null
      // rather than renewing again from a credential it was itself handed.
      return renewCredentialOnce(
        typeof refused === "string" && refused ? refused : deleteToken,
      );
    },

    async transmit(samples, transmitOpts) {
      // Issues-only mode never ships per-page samples — unless the server's
      // dashboard "Full telemetry" grant is on (effectiveIssuesOnly()).
      if (effectiveIssuesOnly()) return 0;
      if (!enabled || isBoosthisDisabled() || samples.length === 0) return 0;
      // Lazy consent — retry if we never captured a delete token.
      if (!deleteToken) {
        await postConsent({ onDemand: true });
      }
      // Race re-check: disable() may have flipped while awaiting consent.
      if (!enabled || isBoosthisDisabled()) return 0;
      if (!deleteToken) {
        // Registration is held by a stated wait: so are these samples.
        if (pausedUntil() !== null) holdSamples([...samples]);
        return 0;
      }
      // Route-label hardening before assertNoPII, mirroring Node: refuse over
      // the shared cap and silently drop any sample whose label
      // carries a PII pattern (UUID, long numeric id, email, JWT, phone).
      // The vitals engine already normalizes dynamic path segments to ":id",
      // so this is defence-in-depth for direct transmit() callers.
      const raw =
        samples.length > MAX_SAMPLE_BATCH
          ? samples.slice(0, MAX_SAMPLE_BATCH)
          : samples;
      const batch = raw
        .filter((s) => {
          if (normalizeRouteLabel(s.routeLabel) === null) {
            warnPartNameRefusal(
              s.routeLabel.length > MAX_PART_NAME ? "too-long" : "invalid",
            );
            return false;
          }
          if (transmitLabelHasPII(s.routeLabel) !== null) {
            warnPartNameRefusal("invalid");
            return false;
          }
          return true;
        })
        .map((s) => {
          const metadata = wireSampleMetadata(s.metadata);
          return {
            routeLabel: s.routeLabel,
            durationMs: s.durationMs,
            rating: s.rating,
            ...(s.ruleId !== undefined ? { ruleId: s.ruleId } : {}),
            ...(metadata ? { metadata } : {}),
          };
        })
        ;
      if (batch.length < raw.length) noteUploadRejected("rejected");
      if (batch.length === 0) return 0;
      const payload = {
        installId: activeInstallId,
        packageVersion: RUNTIME_VERSION,
        samples: batch,
      };
      if (uploadPayloadRefused(payload)) return 0;
      try {
        const { res, refusal } = await sendUpload(
          (credential) =>
            _gatedTransmitInternal(
              `${endpoint}/samples`,
              payload,
              // On the way out of the page a normal fetch is killed by the
              // navigation, so the last page view's measurement is lost — the
              // common case on a plain multi-page site, where nearly every
              // visit ends before the 30s cadence fires.
              transmitOpts?.keepalive
                ? { ...fetchOptions, keepalive: true }
                : fetchOptions,
              `Bearer ${credential}`,
            ),
          transmitOpts?.keepalive === true,
        );
        if (res.status === 429 && !isNoSendResponse(res)) {
          // Asked to wait: the batch is held for the next permitted upload,
          // never counted as refused or lost.
          _noteUploadResponseForTests(res, "samples");
          holdSamples(batch);
          return 0;
        }
        if (res.status >= 500) holdSamples(batch);
        return judgeUpload(res, refusal) ? batch.length : 0;
      } catch (error) {
        if (error instanceof PIIDetectedError) noteUploadRejected("rejected");
        else {
          noteUploadUnreachable();
          holdSamples(batch);
        }
        return 0;
      }
    },

    async transmitSnapshot(snapshot, transmitOpts) {
      // The snapshot carries page labels, so it rides the optional
      // full-detail channel. Mirrors Node/RN transmitSnapshot.
      if (!effectiveSnapshotUploadAllowed()) return 0;
      if (!enabled || isBoosthisDisabled()) return 0;
      if (!deleteToken) {
        await postConsent({ onDemand: true });
      }
      // Race re-check: disable()/forget() may have flipped while awaiting.
      if (!effectiveSnapshotUploadAllowed()) return 0;
      if (!deleteToken) return 0;
      // Filter every label field before the PII guard: page-row keys are
      // code-derived normalized paths, but drop any entry whose label still
      // carries a PII pattern.
      const safeRows = snapshot.rows.filter(
        (r) => transmitLabelHasPII(r.key) === null,
      );
      // The route list is a NEW way for labels to reach the wire, so it is
      // re-audited here rather than trusted from where it was built. An entry
      // that fails is DROPPED, never redacted into something that would read
      // as a route. `total` is left alone deliberately: it states how many
      // the merge held, so a shortened list still reads as "at least".
      const safeRouteList = snapshot.routeList
        ? {
            ...snapshot.routeList,
            entries: snapshot.routeList.entries.filter(
              (e) => transmitLabelHasPII(e.label) === null,
            ),
          }
        : undefined;
      // The control census is the OTHER new way a string reaches the wire, so
      // it is re-audited here too rather than trusted from where it was
      // built. A handle is not screened for PII — it is required to BE a
      // handle, matching the closed shape `controlHandle.ts` produces, which
      // no label, name or value can satisfy. `to` is a route label and goes
      // through the same guard every other label does. An entry failing
      // either is DROPPED whole; `total` is left alone so a shortened list
      // still reads as "at least".
      const safeControlCensus = snapshot.controlCensus
        ? {
            ...snapshot.controlCensus,
            entries: snapshot.controlCensus.entries.filter(
              (e) =>
                isControlHandle(e.handle) &&
                (e.to === undefined || transmitLabelHasPII(e.to) === null),
            ),
          }
        : undefined;
      if (
        safeRows.length < snapshot.rows.length ||
        (safeRouteList && safeRouteList.entries.length < snapshot.routeList!.entries.length) ||
        (safeControlCensus && safeControlCensus.entries.length < snapshot.controlCensus!.entries.length)
      ) noteUploadRejected("rejected");
      const sanitizedSnapshot = {
        ...snapshot,
        rows: safeRows,
        ...(safeRouteList ? { routeList: safeRouteList } : {}),
        ...(safeControlCensus ? { controlCensus: safeControlCensus } : {}),
      };
      // The page map rides THIS upload — same gates, same back-off, same
      // batching, no round trip of its own — and only when the host asked
      // for it. A sibling of `snapshot` rather than a field inside it,
      // because the snapshot is stored as sent and this is screened and
      // stored separately.
      const pageMap = sendPageMap ? buildPageMapWire() : null;
      const payload = {
        installId: activeInstallId,
        packageVersion: RUNTIME_VERSION,
        capturedAt: sanitizedSnapshot.capturedAt,
        // The interval this browser is really keeping between snapshots, so
        // the server can tell how many visitors share this install and say
        // when the next snapshot is useful (snapshotPacing on the server).
        snapshotIntervalMs: plannedSnapshotIntervalMs(),
        snapshot: sanitizedSnapshot,
        ...(pageMap ? { pageMap } : {}),
      };
      if (uploadPayloadRefused(payload)) return 0;
      // Stamped for every tab of this browser before the request leaves — a
      // closing page's stamp must outlive it, or the page replacing it sends
      // again — and taken back if the kit answered itself instead.
      const previousSend = lastSentAt("snapshot");
      const stampedAt = noteSent("snapshot");
      try {
        const { res, refusal } = await sendUpload(
          (credential) =>
            _gatedTransmitInternal(
              `${endpoint}/snapshots`,
              payload,
              // On the way out of the page a normal fetch is killed by the
              // navigation. Short visits never survive the 60s snapshot
              // cadence, so without the keepalive exit flush a real page's
              // snapshot (with its axes) would never land server-side at all.
              transmitOpts?.keepalive
                ? { ...fetchOptions, keepalive: true }
                : fetchOptions,
              `Bearer ${credential}`,
            ),
          transmitOpts?.keepalive === true,
        );
        if (isNoSendResponse(res) || isLocalPauseAnswer(res)) {
          unnoteSent("snapshot", stampedAt, previousSend);
        }
        // A 429 pauses every path; the snapshot is a replaceable summary, so
        // nothing is held — the next one after the wait carries newer data.
        return judgeUpload(res, refusal, "snapshot") ? 1 : 0;
      } catch (error) {
        if (error instanceof PIIDetectedError) noteUploadRejected("rejected");
        else noteUploadUnreachable();
        return 0;
      }
    },

    async transmitCrashes(crashes, sealed, keepalive) {
      // Always-on for registered apps: NOT gated by the enable/disable toggle
      // or issues-only mode. Only the kill-switch (BOOSTHIS_DISABLED) or
      // forget() can stop it — mirrors Node transmitCrashes, NOT the snapshot.
      if (isBoosthisDisabled() || !maySendToServer() || crashes.length === 0) return 0;
      // Direct callers enter the same durable pipeline; only its sealed
      // submitter is allowed to reach the wire. A queued call is not acceptance.
      if (!sealed) {
        for (const crash of crashes) {
          const kept = { ...crash, occurredAt: Math.trunc(crash.occurredAt ?? Date.now()) };
          // An error the page caught is never a crash: it is kept apart from
          // the crash history the crash-free reading counts.
          if (crash.kind === "caughtByPage") keepCaught(kept);
          else if (crash.kind !== "render") keepCrash(kept);
        }
        return 0;
      }
      // Lazy consent — retry if the host never captured a delete token.
      if (!deleteToken) {
        await postConsent({ onDemand: true });
      }
      if (isBoosthisDisabled()) return 0;
      if (!deleteToken) return 0;
      // Server caps a batch at 50 reports (CrashBatch.maxItems).
      const batch = crashes.filter(crash => crash.kind !== "render").slice(0, 50);
      if (batch.length === 0) return 0;
      const payload = {
        installId: sealed.installId,
        packageVersion: RUNTIME_VERSION,
        deliveryId: sealed.deliveryId,
        crashes: batch,
      };
      if (sealed.installId !== activeInstallId) return 401;
      if (keepalive && new TextEncoder().encode(JSON.stringify(payload)).byteLength >= 64000) {
        noteUploadRejected("rejected");
        return 413;
      }
      // Defense in depth — every crash fingerprint is code-derived on-device
      // (error name + redacted frame + bucketed count, never the raw message),
      // but the shared PII guard still runs before upload.
      if (uploadPayloadRefused(payload)) return 400;
      try {
        // A retry after a renewal resends the SAME delivery id, so a batch
        // that did land the first time is never stored twice.
        const { res, refusal } = await sendUpload(
          (credential) =>
            _gatedTransmitInternal(
              `${endpoint}/crashes`,
              payload,
              keepalive ? { ...fetchOptions, keepalive: true, signal: undefined } : fetchOptions,
              `Bearer ${credential}`,
            ),
          keepalive === true,
        );
        // /crashes returns 202 Accepted; res.ok covers 2xx.
        judgeUpload(res, refusal, "crashes");
        return isNoSendResponse(res) ? 0 : res.status;
      } catch (error) {
        if (error instanceof PIIDetectedError) {
          noteUploadRejected("rejected");
          return 400;
        }
        noteUploadUnreachable();
        return 0;
      }
    },

    async transmitCandidates(signatures, transmitOpts) {
      // Always-on for registered apps: NOT gated by the enable/disable toggle
      // or issues-only mode. Only the kill-switch (BOOSTHIS_DISABLED) or
      // forget() can stop it — mirrors transmitCrashes, NOT the snapshot.
      if (isBoosthisDisabled() || signatures.length === 0) return 0;
      // Lazy consent — retry if the host never captured a delete token.
      if (!deleteToken) {
        await postConsent({ onDemand: true });
      }
      // Race re-check: forget()/the kill-switch may have flipped while awaiting.
      if (isBoosthisDisabled()) return 0;
      if (!deleteToken) return 0;
      // Server caps a batch at 50 signatures.
      const batch =
        signatures.length > 50 ? signatures.slice(0, 50) : signatures;
      const payload = {
        installId: activeInstallId,
        packageVersion: RUNTIME_VERSION,
        signatures: batch,
      };
      // Defense in depth — a signature is built by Boosthis from
      // kind + severity bucket + count bucket; the part and the cause beside
      // it carry page labels, closed words and numbers only. The shared PII
      // guard still runs over all of it before it leaves.
      if (uploadPayloadRefused(payload)) return { accepted: 0, undelivered: "refused" };
      try {
        const { res, refusal } = await sendUpload(
          (credential) =>
            _gatedTransmitInternal(
              `${endpoint}/candidates`,
              payload,
              // A closing page is the common ending in a browser, so the exit
              // flush must outlive the document exactly like the sample and
              // snapshot flushes do.
              transmitOpts?.keepalive
                ? { ...fetchOptions, keepalive: true }
                : fetchOptions,
              `Bearer ${credential}`,
            ),
          transmitOpts?.keepalive === true,
        );
        const accepted = judgeUpload(res, refusal, "candidates");
        return accepted ? batch.length : [400, 413, 422].includes(res.status)
          ? { accepted: 0, undelivered: "refused" } : 0;
      } catch (error) {
        if (error instanceof PIIDetectedError) {
          noteUploadRejected("rejected");
          return { accepted: 0, undelivered: "refused" };
        }
        noteUploadUnreachable();
        return 0;
      }
    },

    async transmitResolutions(resolutions, transmitOpts) {
      // Always-on for registered apps, exactly like transmitCandidates.
      if (isBoosthisDisabled() || resolutions.length === 0) return 0;
      if (!deleteToken) {
        await postConsent({ onDemand: true });
      }
      if (isBoosthisDisabled()) return 0;
      if (!deleteToken) return 0;
      const batch =
        resolutions.length > 50 ? resolutions.slice(0, 50) : resolutions;
      const payload = {
        installId: activeInstallId,
        packageVersion: RUNTIME_VERSION,
        resolutions: batch,
      };
      if (uploadPayloadRefused(payload)) return { accepted: 0, undelivered: "refused" };
      try {
        const { res, refusal } = await sendUpload(
          (credential) =>
            _gatedTransmitInternal(
              `${endpoint}/resolutions`,
              payload,
              transmitOpts?.keepalive
                ? { ...fetchOptions, keepalive: true }
                : fetchOptions,
              `Bearer ${credential}`,
            ),
          transmitOpts?.keepalive === true,
        );
        const accepted = judgeUpload(res, refusal, "resolutions");
        return accepted ? batch.length : [400, 413, 422].includes(res.status)
          ? { accepted: 0, undelivered: "refused" } : 0;
      } catch (error) {
        if (error instanceof PIIDetectedError) {
          noteUploadRejected("rejected");
          return { accepted: 0, undelivered: "refused" };
        }
        noteUploadUnreachable();
        return 0;
      }
    },

    async transmitSpans(spans) {
      // Trace spans carry code-defined route labels, so they ride the SAME
      // gate as the snapshot mirror: off in issues-only mode unless the
      // developer opted in via `shareMeterWithAI` OR the server directive
      // fired. Always gated off when disabled or killed. Mirrors Node/RN.
      if (!effectiveSnapshotUploadAllowed()) return 0;
      if (!enabled || isBoosthisDisabled() || spans.length === 0) return 0;
      // Lazy consent — retry if the host never captured a delete token.
      if (!deleteToken) {
        await postConsent({ onDemand: true });
      }
      // Race re-check: disable()/forget() may have flipped while awaiting.
      if (!effectiveSnapshotUploadAllowed()) return 0;
      if (!deleteToken) return 0;
      // Drop any span whose label carries a PII pattern. The labels are
      // code-defined ("GET /users/:id", ids redacted by spanLabel), but a
      // caller could pass a user-derived string. Use transmitLabelHasPII —
      // the same guard as sample uploads — which enforces UUID, long numeric
      // id, and whitespace checks while still allowing the structural
      // "HTTP_METHOD /path" space that span labels legitimately carry.
      const safe = spans.filter((s) => transmitLabelHasPII(s.routeLabel) === null);
      if (safe.length < spans.length) noteUploadRejected("rejected");
      const batch =
        safe.length > MAX_SPAN_BATCH ? safe.slice(0, MAX_SPAN_BATCH) : safe;
      if (batch.length === 0) return 0;
      const payload = {
        installId: activeInstallId,
        packageVersion: RUNTIME_VERSION,
        spans: batch,
      };
      // Defense in depth — the per-label filter already dropped any PII-bearing
      // span, but run the whole-payload guard before it leaves.
      if (uploadPayloadRefused(payload)) return 0;
      try {
        const { res, refusal } = await sendUpload(
          (credential) =>
            _gatedTransmitInternal(
              `${endpoint}/spans`,
              payload,
              fetchOptions,
              `Bearer ${credential}`,
            ),
          false,
        );
        if (res.status === 429 && !isNoSendResponse(res)) {
          // Asked to wait: the batch goes back to the head of the buffer for
          // the next permitted upload — never counted as refused or lost.
          _noteUploadResponseForTests(res, "spans");
          holdSpanBatch(batch);
          return 0;
        }
        if (res.status >= 500) holdSpanBatch(batch);
        return judgeUpload(res, refusal) ? batch.length : 0;
      } catch (error) {
        if (error instanceof PIIDetectedError) noteUploadRejected("rejected");
        else {
          noteUploadUnreachable();
          holdSpanBatch(batch);
        }
        return 0;
      }
    },

    disable() {
      // disable() stops the optional full-detail channels: samples + the
      // screen-bearing snapshot mirror. syncSnapshotUpload() clears the
      // submitter (not just the timer) so a manual flush cannot leak a
      // snapshot after disable().
      enabled = false;
      sampleQueue = [];
      if (sampleTimer !== null) {
        clearTimeout(sampleTimer);
        sampleTimer = null;
      }
      // Cancel any pending rejected-registration retry — the fire-time guard
      // would no-op it anyway, but don't leave a dead timer pending.
      stopConsentRetry();
      syncSampleObserver();
      syncSnapshotUpload();
    },
    enable() {
      if (isDissolvedThisRun()) return;
      enabled = true;
      syncSampleObserver();
      syncSnapshotUpload();
    },

    applyServerFullTelemetry(on: boolean) {
      if (isDissolvedThisRun()) return;
      // Mirror the consent-response directive-apply (see postConsent above): a
      // no-op when the value is unchanged; otherwise flip the session directive
      // and re-wire the sample firehose + snapshot mirror to the new mode. The
      // bubble's signed-in account card calls this after its own successful
      // toggle POST so the new mode takes effect immediately (no relaunch). It
      // never overrides disable()/forget()/BOOSTHIS_DISABLED — the sync helpers
      // both re-check enabled + the kill-switch.
      if (typeof on !== "boolean" || on === serverFullTelemetry) return;
      serverFullTelemetry = on;
      syncSampleObserver();
      syncSnapshotUpload();
      // Flipping the switch from the bubble is the other way into a
      // contradiction, and it takes effect without a relaunch — so the same
      // sentence has to be available from here too.
      noteTelemetryModeContradiction();
    },

    async forget() {
      // Clear this client's identity, queues and delivery hooks even without
      // a delete token, then sweep every boosthis: key this kit keeps in this
      // browser (below), as the privacy page says forget() does.
      if (isDissolvedThisRun()) return 0;
      setSampleObserver(null);
      unwirePagehideFlush();
      sampleQueue = [];
      if (sampleTimer !== null) {
        clearTimeout(sampleTimer);
        sampleTimer = null;
      }
      // Cancel any pending rejected-registration retry — forget() must leave
      // no registration retry running for this client.
      stopConsentRetry();
      // Stop the server-authority heartbeat and RE-LOCK the kit: erasure must
      // leave no entitlement permission behind and a copy without a proven
      // handshake must not run (the ACTIVATION LOCK re-engages exactly as on a
      // never-connected install). Best-effort, never throws.
      stopEntitlementCheckin();
      try {
        clearEntitlementCache();
      } catch {
        // best-effort — the in-memory lock is already engaged
      }
      setSnapshotSubmitter(null);
      stopSnapshotAutoUpload();
      unwireSnapshotPagehideFlush();
      // Tear down the span mirror too: stop the flusher, unwire the submitter
      // (making enqueueSpan inert), and drop any buffered spans.
      setSpanSubmitter(null);
      stopSpanAutoFlush();
      clearBufferedSpans();
      // The shared upload schedule (uploadPacing.ts) goes too: its last-send
      // stamps, any pause, the last check-in and the samples a closing page
      // handed over. Nothing Boosthis-shaped is left behind.
      clearUploadPace();
      // Crash reporting is ALWAYS-ON for a registered app; forget() (and the
      // kill-switch) are the only things that stop it. Clear the submitter and
      // uninstall the window error/unhandledrejection hooks, wiping the
      // in-memory buffer AND the persisted pending/history crash keys.
      setCrashSubmitter(null);
      await uninstallCrashHandlers();
      // Problem reporting, same treatment: stop the loop, unwire the exit
      // flush, drop both submitters (making any later tick inert), and erase
      // the accumulated candidate + baseline keys from storage. Nothing may
      // survive as leaked state into the next page load.
      stopReporting();
      setCandidateSubmitter(null);
      setResolutionSubmitter(null);
      clearAllCandidates();
      // Drop the per-call observed/failed counts. They hold nothing but two
      // numbers against a label that never leaves this page, but `forget()`
      // drops these observed counts, and a count that survives
      // erasure is a count the next snapshot would upload about a period this
      // install has been told to forget.
      resetRouteOutcomes();
      // Put the page's own Web Storage methods back the way we found them and
      // drop the two counters behind them. The local-store readings observe
      // the HOST's data path, so erasure has to hand that path back
      // untouched: leaving `Storage.prototype` wrapped would keep this page
      // running Boosthis code after it was told to forget, and leaving the
      // counts would let operations from before the erasure be reported by a
      // later start as if they had just been measured.
      uninstallLocalStoreTracking();
      // Erase persisted state (privacy parity — forget leaves nothing
      // Boosthis-shaped in storage).
      readToken = null;
      storage.remove(readTokenStoreKey);
      storage.remove(crashDetailsStoreKey);
      serverCrashDetails = false;
      storage.remove("installId");
      // The day's anonymous visit tag too, and this page's own copy of it: an
      // erased install leaves no value behind for the next upload to reuse.
      clearVisitTag();
      // Including the panel's own count of page views measured on this
      // device. It never leaves the page and it is only two integers, but it
      // is Boosthis-shaped state that outlives a page load, and a count that
      // survives erasure would let this browser keep reporting a period the
      // install has been told to forget.
      clearPageViewTally();
      // And the press→screen join, including its counts of presses that
      // reached no timed screen: an erased install keeps no tally of what it
      // watched, not even the parts it could not measure.
      resetPressToScreen();
      // Including the memory that this install was ever registered: an
      // erased install must not leave a record of its own registration
      // behind to soften the next page's verdict.
      forgetRegistered(activeInstallId);
      forgetRegistered(opts.installId);
      // Erase the self-healing rotation mapping too. The forget request below
      // (sent under the ROTATED identity when one is active) erases the
      // identity that actually owns the uploaded data.
      storage.remove(rotationStoreKey);
      // Then everything else this kit keeps in this browser: the same sweep
      // the visitor's own off switch and the dissolved erase use. It removes
      // every boosthis: key on this site, including a sign-in made in the
      // kit's panel, the owner pass, settings the kit wrote and the records
      // of any other Boosthis client on the same site, and nothing belonging
      // to the site itself. The privacy page says forget() removes all of
      // it, and now it does.
      clearDeviceStorage();
      if (!deleteToken) {
        enabled = false;
        return 0;
      }
      // Kill-switch honors silence even on erasure: never touch the network,
      // but still clear local state.
      if (isBoosthisDisabled()) {
        deleteToken = null;
        enabled = false;
        return 204;
      }
      // Right-to-erasure: the fixed payload legitimately contains the
      // server-issued `deleteToken` field (which the PII guard would
      // otherwise reject by field name). `_safeTransmitTrustedPayload` skips
      // ONLY the payload-body check while still scanning caller-supplied
      // headers + URL and honoring the kill-switch.
      const token = deleteToken;
      try {
        const res = await outsideAngular(() =>
          _safeTransmitTrustedPayload(
            `${endpoint}/installs/forget`,
            {
              installId: activeInstallId,
              deleteToken: token,
            },
            fetchOptions,
          ),
        );
        deleteToken = null;
        enabled = false;
        return res.status;
      } catch {
        return 0;
      }
    },
  };

  // Wire the full-sample queue the moment telemetry is enabled (full mode
  // only — issues-only apps never queue a sample until the dashboard "Full
  // telemetry" directive flips them into full mode) and the snapshot mirror
  // per the initial share policy.
  syncSampleObserver();
  syncSnapshotUpload();

  // Crash reporting is ALWAYS-ON for a registered app (independent of the
  // enable/disable toggle and issues-only mode) — the window error /
  // unhandledrejection listeners are OBSERVE-ONLY and never change the host's
  // crash behavior. Only the kill-switch (`BOOSTHIS_DISABLED`), `forget()` or
  // a withheld end-user consent stops it.
  //
  // Extracted into a function because those last two both UNWIRE it, and a
  // visitor who says yes after saying no has to get a working kit rather than
  // a half-wired one. Called once here, and again when consent reopens.
  function wireAlwaysOnChannels(): void {
    if (isRuntimeInert()) return;
    // Wire the submitter first, then install the listeners.
    setCrashSubmitter((crashes, batch, keepalive) => client.transmitCrashes(crashes, batch, keepalive), () => activeInstallId);
    installCrashHandlers({ detailed: opts.crashDetails === true || serverCrashDetails, subscribeEntitlement });

    // Problem reporting is ALWAYS-ON for a registered app too — same gate as
    // crash reporting, and for the same reason: a recurring problem a real
    // visitor hit has to be able to teach us something whether or not the
    // developer ever connected an AI. Wire both submitters first, then start
    // the (slow) accumulation loop, which also flushes on `pagehide` so a page
    // closed after ten seconds still delivers what it saw.
    setCandidateSubmitter((signatures, submitOpts) =>
      client.transmitCandidates(signatures, submitOpts),
    );
    setResolutionSubmitter((resolutions, submitOpts) =>
      client.transmitResolutions(resolutions, submitOpts),
    );
    startReporting();
  }
  wireAlwaysOnChannels();
  registerLockLifecycle({
    uninstall: () => {
      setSampleObserver(null);
      unwirePagehideFlush();
      if (sampleTimer !== null) clearTimeout(sampleTimer);
      sampleTimer = null;
      setSnapshotSubmitter(null);
      stopSnapshotAutoUpload();
      unwireSnapshotPagehideFlush();
      setSpanSubmitter(null);
      stopSpanAutoFlush();
      setCrashSubmitter(null);
      void uninstallCrashHandlers();
      stopReporting();
      setCandidateSubmitter(null);
      setResolutionSubmitter(null);
    },
    clear: () => {
      sampleQueue = [];
      clearBufferedSpans();
      clearAllCandidates();
      resetRouteOutcomes();
      clearUploadPace();
      clearSettle();
    },
    dropHandovers: () => {
      serverShareMeterWithAI = false;
      serverFullTelemetry = null;
      // The project's detailed-crash switch came with the same answer. The
      // reconnect registration hands it back once the project is active.
      serverCrashDetails = false;
    },
    reinstall: () => {
      syncSampleObserver();
      syncSnapshotUpload();
      wireAlwaysOnChannels();
    },
    erase: () => {
      stopConsentRetry();
      readToken = null;
      deleteToken = null;
      enabled = false;
      opts = { ...opts, deleteToken: undefined, readToken: undefined };
    },
  });

  // Persist the install id so a Node-side MCP entrypoint (or a later session)
  // can fall back to it together with the persisted read token. Best-effort.
  // Uses the ACTIVE identity (post-rotation when a persisted mapping was
  // adopted) so external readers always see the id that owns the data.
  storage.set("installId", activeInstallId);

  // Register as the active client so display-only surfaces (the bubble's
  // dashboard panel + account card) can read the live endpoint / installId /
  // tokens. Last-wins: a host that re-enables replaces the previous client.
  activeClient = client;

  /* ─── The switch the customer's banner drives ──────────────────────────
   *
   * The two gates — `storage.ts` for the device, `transmit.ts` for the
   * network — already make a withheld install store nothing and send
   * nothing on their own. What is left for this client to do is the part a
   * gate cannot: stop the timers that would now produce nothing, drop what
   * is held in memory, ask the server to delete what was already sent, and
   * put it all back if the visitor changes their mind.
   */

  /** Withdraw. The device has ALREADY been cleared by the gate before this
   *  runs; this is everything else erasure means. */
  async function standDownForWithheldConsent(): Promise<void> {
    let token = deleteToken;
    // disable() stops the sample firehose + snapshot/span mirrors and the
    // rejected-registration retry, and clears their submitters.
    client.disable();
    stopEntitlementCheckin();
    try {
      clearEntitlementCache();
    } catch {
      // best-effort — the in-memory lock is already engaged
    }
    setCrashSubmitter(null);
    await uninstallCrashHandlers();
    stopReporting();
    setCandidateSubmitter(null);
    setResolutionSubmitter(null);
    clearAllCandidates();
    clearBufferedSpans();
    resetRouteOutcomes();
    clearPageViewTally();
    resetPressToScreen();
    forgetRegistered(activeInstallId);
    forgetRegistered(opts.installId);
    storage.remove(crashDetailsStoreKey);
    serverCrashDetails = false;
    readToken = null;
    deleteToken = null;
    // NOT uninstallLocalStoreTracking(). forget() hands the page's own
    // Storage methods back because forget() is final; this is not. The
    // wrapper holds two in-memory counters and writes nothing anywhere, and
    // unwiring it here would cost the host's local-store reading for the
    // rest of the page load even if the visitor says yes a second later —
    // a silently missing reading bought for no privacy gain.
    //
    // A REGISTRATION ALREADY IN FLIGHT IS PART OF WHAT MUST BE ERASED.
    //
    // The local half above is done first and without waiting, so nothing is
    // measured or written for another moment. The erasure is what has to
    // wait: a registration asked a moment before the withdrawal is still
    // going to be answered, and until it is we do not know whether there is
    // an install on the server at all, or which token deletes it. That reply
    // adopts nothing (see `askServerToRegister`) but keeps the token it was
    // issued, and this is where it is spent.
    await settleRegistrationsInFlight();
    if (tokenIssuedAfterWithdrawal) {
      token = tokenIssuedAfterWithdrawal;
      tokenIssuedAfterWithdrawal = null;
    }
    // ASKING THE SERVER TO DELETE. Deliberately still sent: the erasure path
    // is not behind the consent gate, because a visitor who has just
    // withdrawn permission needs the delete request to arrive. Refusing to
    // send it would leave their data with us and call that privacy.
    if (token && !isBoosthisDisabled()) {
      try {
        await outsideAngular(() =>
          _safeTransmitTrustedPayload(
            `${endpoint}/installs/forget`,
            { installId: activeInstallId, deleteToken: token },
            fetchOptions,
          ),
        );
      } catch {
        // An unreachable server does not undo the local half.
      }
    }
  }

  /** Permission arrives (or is downgraded to `memory-only`) after a period of
   *  `withheld`. Re-wire what standing down unwired and register again — a
   *  visitor who says yes gets a working kit, not a half-wired one. */
  function standUpAfterConsent(): void {
    client.enable();
    wireAlwaysOnChannels();
    installCheckinConfig();
    void postConsent();
  }

  // THE TWO HALVES ARE SERIALISED.
  //
  // Standing down is asynchronous — the crash handlers come off, then the
  // server is asked to delete what it holds — and a visitor who says no and
  // then yes again inside that window would otherwise be stood back up by a
  // grant whose teardown lands a moment later and takes the resumed page
  // apart again (tokens nulled, reporting stopped, submitters cleared). So a
  // grant waits for the stand-down it follows, and then checks it is still
  // the most recent word: a change that has itself been superseded does
  // nothing at all.
  let consentEpoch = 0;
  let consentStandDown: Promise<unknown> = Promise.resolve();

  _onEndUserConsentChange((change) => {
    const epoch = ++consentEpoch;
    try {
      if (change.state === "withheld") {
        // Synchronously, before anything is awaited: a registration answered
        // from here on belongs to a permission that no longer exists.
        withdrawalGeneration += 1;
        consentStandDown = standDownForWithheldConsent().catch(() => undefined);
        return;
      }
      if (change.previous === "withheld") {
        const pending = consentStandDown;
        void (async () => {
          try {
            await pending;
            if (epoch !== consentEpoch) return;
            standUpAfterConsent();
          } catch {
            // A consent change must never throw into the host page.
          }
        })();
        return;
      }
      // granted → memory-only. The device has been cleared and every write
      // from here lands in memory; measurement and upload carry on, which is
      // the whole point of the mode. What was already read off the device
      // into memory before the switch stays in memory for this page load —
      // it is no longer ON the device, which is what was asked for.
    } catch {
      // A consent change must never throw into the host page.
    }
  });

  // A RETURNING VISITOR IS NOT A FAULT.
  //
  // The startup line promises a registration on every load, but a page that
  // already holds a credential for this install deliberately does not register
  // again — so "announced and never asked" describes a perfectly healthy
  // repeat visit as well as the failure this watch exists to catch. Only the
  // server can tell those apart (the credential may equally be stale, or have
  // been copied from another install), so when the deadline arrives with no
  // attempt made, this asks it. A page holding nothing at all is not worth a
  // request: it cannot be the healthy case.
  setRegistrationProbe(async () => {
    // Either this page holds a credential, or this browser has watched
    // Boosthis accept this very install id before. The second is the reloaded
    // healthy page: registration is durable, so a page that cannot produce a
    // token is "cannot tell", never "it never registered".
    if (!deleteToken && !readToken && !wasRegisteredBefore(activeInstallId)) {
      return false;
    }
    try {
      await checkRegistrationOnce({
        endpoint,
        installId: activeInstallId,
        projectKey: projectKey.key,
        ...(fetchOptions.fetchImpl ? { fetchImpl: fetchOptions.fetchImpl } : {}),
      });
    } catch {
      // An unanswered check is "cannot tell" — never evidence of a fault.
    }
    return true;
  });

  // Install the server-authority kill-switch heartbeat + run the FORCED launch
  // check-in (VAULT contract's on-launch enforcement edge). Web storage is
  // synchronous so the rotation mapping was already adopted above, but we still
  // defer the kick to a microtask to match the Node runtime's post-rotation
  // timing — enableTelemetry() must return without a synchronous network call,
  // and the disabled/kill state is re-read at kick time. Fail-open, never
  // throws into the host.
  void Promise.resolve()
    .then(() => {
      if (!enabled || isBoosthisDisabled()) return;
      installCheckinConfig();
      scheduleFirstPageRegistration();
    })
    .catch(() => {
      // never throw into the host
    });

  // A FIRST-EVER PAGE REGISTERS ON ITS OWN.
  //
  // Nothing is measured until Boosthis has registered this page and answered
  // `active` (docs/kit-lock-rule.md), and that answer needs the credential a
  // registration hands over. A page started with enableTelemetry() used to
  // register lazily, on its first upload, and that upload only came because
  // the kit measured before it had been told anything. Measuring now waits
  // for the answer, so a page holding no credential would never upload, never
  // register and never be told `active`: dark for ever. The phone kits
  // register at launch and the hosted tag registers a first-ever page two
  // seconds in. This start now does the same, once, a moment after the tag's
  // own ask would have gone, and never on top of an ask already made here, so
  // a tag page still asks exactly once. A page holding a credential checks in
  // with it instead, and a keyless page has nothing to register with.
  function scheduleFirstPageRegistration(): void {
    if (deleteToken || readToken || !projectKey.key) return;
    kitTimeout(() => {
      if (!enabled || isBoosthisDisabled() || isDissolvedThisRun()) return;
      if (registrationAskedThisPage || deleteToken || readToken) return;
      if (!maySendToServer()) return;
      void postConsent({ onDemand: true }).catch(() => {
        // postConsent only throws on PII-guard bugs; never crash the host.
      });
    }, FIRST_PAGE_REGISTRATION_DELAY_MS);
  }

  return client;
}

/** When a first-ever page started with enableTelemetry() asks to register:
 *  just after the hosted tag's own ask (2 s), so a tag page asks once. */
const FIRST_PAGE_REGISTRATION_DELAY_MS = 2_500;
/** How long a keyless page waits before saying so on the console, when no
 *  registration round trip has settled to claim the line first. */
const NO_KEY_ANNOUNCE_DELAY_MS = 15_000;

export function isPageMapSendEnabled(): boolean {
  return pageMapSendRequested;
}
