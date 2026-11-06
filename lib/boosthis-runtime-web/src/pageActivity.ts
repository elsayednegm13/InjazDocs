/**
 * WHAT THIS PAGE VIEW CONSISTED OF — and whether the kit could see it.
 *
 * From a live customer storefront (Sep 2026). Two storefronts for the same
 * restaurant were driven through a headless browser for 43 minutes and
 * completed a comparable number of real orders: 116 on the React storefront,
 * 120 on the plain one. Same kit, same project, same journeys. The plain
 * storefront produced hundreds of readings. The React one produced fewer than
 * ten.
 *
 * The cause is not the drawers, and it is not a sampling gate. A reading is
 * recorded when a page view ends, and only a DOCUMENT brings a load timing of
 * its own: the first view of a page carries the browser's paint or first byte,
 * and a later screen inside the same document has a number only where the
 * browser times soft navigations. At the time, a single-page app also had
 * exactly one page view however many screens a person moved through, so a
 * React storefront that changed the address on every step was just as quiet as
 * one built out of drawers — measured, both arms produced one reading where the
 * plain twin produced one hundred and twenty (see PAGE-VIEW-READINGS.md in
 * this kit).
 *
 * The kit has since closed a view at every change of screen — an address
 * change it sees, or a host's flushPageSample() — and counts a view the
 * browser timed nothing for as untimed rather than repeating the first view's
 * number. Each reading is filed under the route of the screen it measured,
 * taken when its view OPENED: until 1.0.0-alpha.153 a view closed by an
 * address change took the route after the address had moved, so it was filed
 * under the next screen. One address change is decided once (a boundary, a
 * start-up relabel, or the second half of a host's flush), and every count
 * here follows that one decision.
 *
 * That is defensible behaviour and it was still wrong as a product, because
 * nothing anywhere said so. "Almost nothing arrived" and "your app never gave
 * us a second page view to time" are completely different facts and they read
 * identically on a dashboard showing one reading.
 *
 * This module is the fifth answer the kit could not previously give. It holds
 * the counts that separate the two — address changes, presses, readings taken,
 * view changes that could not be timed — and turns them into ONE closed word,
 * plus the sentences the kit's own surfaces and our server put around it.
 *
 * Two rules it must never break:
 *  - A count of zero presses is only honest when something was watching. Where
 *    the click watch never installed, the word is "cannot tell", never "idle":
 *    a silence needs positive evidence before it is called an empty page.
 *  - Nothing here is a label, a URL or anything a person typed. Counts and one
 *    word from a closed list — that is the whole vocabulary, on every surface
 *    and on the wire.
 */

/**
 * The closed vocabulary. Four answers, and they must not be confusable:
 *  - `unwatched`  — the kit cannot watch presses here, so it makes NO claim
 *                   about whether the app was used.
 *  - `idle`       — watched, and genuinely nothing happened: no press, no
 *                   address change. A quiet page really is a quiet page.
 *  - `in-place`   — the app was used, and the address never changed. The kit
 *                   sees the work and has no second page view to time.
 *  - `navigating` — the address changed at least once, so this app does
 *                   present separate pages.
 */
export type PageActivityWord = "unwatched" | "idle" | "in-place" | "navigating";

export interface PageActivityFacts {
  /** Changes of screen observed since the kit started (SPA pushes,
   *  replaceState, back/forward). The first page is the baseline, not a
   *  change; a hash- or query-only change is not a change of screen, and an
   *  address the app settled on at start-up before anything was painted or
   *  touched replaces the baseline rather than counting. */
  viewChanges: number;
  /** View changes the kit could not time, because no measurement belonged to
   *  the new view. Counted rather than filled in with the previous view's
   *  number — see finalizePageSample in vitals.ts. */
  viewChangesUntimed: number;
  /** Readings actually recorded this document. */
  readings: number;
  /** Presses observed (actionable + dead). Zero is only meaningful when
   *  `watching` is true. */
  presses: number;
  /** Could the kit watch interactions at all on this page? */
  watching: boolean;
  /** The one closed word above. */
  activity: PageActivityWord;
}

/** What the kit can say about interactions, supplied by vitals.ts when — and
 *  ONLY when — the click watch really installed. An unregistered source is
 *  what makes the verdict "cannot tell" rather than "idle". */
export interface InteractionSource {
  /** Presses seen so far (actionable + dead). */
  presses: number;
  /** Any interaction at all was observed, including ones that are not clicks
   *  (an INP measurement proves a person interacted). */
  interacted: boolean;
}

let interactionSource: (() => InteractionSource) | null = null;
let lastLabel: string | null = null;
let viewChanges = 0;
let viewChangesUntimed = 0;
let readings = 0;

/** Register the interaction reader. Called by vitals.ts from inside the block
 *  that installs the click watch, so registration itself is the evidence that
 *  something is watching. */
export function setInteractionSource(fn: (() => InteractionSource) | null): void {
  interactionSource = fn;
}

/** One address seen. The first call sets the baseline; only a DIFFERENT
 *  address after that is a view change. A router that replaces the same
 *  address is not a navigation, and must not read as one.
 *
 *  Returns TRUE only for a real view change, so the caller can close the page
 *  view that just ended without keeping a second copy of this comparison —
 *  one place decides what a view change is. */
export function noteAddress(label: string): boolean {
  try {
    if (typeof label !== "string" || label === "") return false;
    if (lastLabel === null) {
      lastLabel = label;
      return false;
    }
    if (label === lastLabel) return false;
    lastLabel = label;
    viewChanges++;
    return true;
  } catch {
    // bookkeeping must never break the host page
    return false;
  }
}

/** Would `noteAddress(label)` count a view change? Asked BEFORE anything is
 *  counted, so the caller can decide what the change means (a boundary, a
 *  start-up relabel, the second half of a host's flush) with this module
 *  still the one place that says what a change of address is. Counts nothing. */
export function addressChangeFrom(label: string): boolean {
  try {
    if (typeof label !== "string" || label === "") return false;
    return lastLabel !== null && label !== lastLabel;
  } catch {
    return false;
  }
}

/** Move the baseline to `label` WITHOUT counting a view change: the app moved
 *  its address before anyone saw the page (a start-up redirect), which is not
 *  a change of screen a person made. The next real change is judged from
 *  here. */
export function rebaseAddress(label: string): void {
  try {
    if (typeof label !== "string" || label === "") return;
    lastLabel = label;
  } catch {
    // bookkeeping must never break the host page
  }
}

/** A reading was recorded. */
export function noteReadingTaken(): void {
  readings++;
}

/** A view ended with no measurement that belonged to it. Counted here instead
 *  of recorded as a reading, because the only number available was the FIRST
 *  view's and repeating it invents a measurement nobody took. */
export function noteUntimedViewChange(): void {
  viewChangesUntimed++;
}

function readInteractions(): { watching: boolean; presses: number; interacted: boolean } {
  if (!interactionSource) return { watching: false, presses: 0, interacted: false };
  try {
    const s = interactionSource();
    const presses =
      typeof s.presses === "number" && Number.isFinite(s.presses) && s.presses > 0
        ? Math.round(s.presses)
        : 0;
    return { watching: true, presses, interacted: !!s.interacted || presses > 0 };
  } catch {
    // A source that cannot answer is not a source that saw nothing.
    return { watching: false, presses: 0, interacted: false };
  }
}

/** The current picture. Never throws. */
export function pageActivityFacts(): PageActivityFacts {
  const i = readInteractions();
  let activity: PageActivityWord;
  if (viewChanges > 0) {
    // The app does present separate pages — whatever else is true.
    activity = "navigating";
  } else if (!i.watching) {
    // Nothing was watching, so "no activity" is not a finding we hold.
    activity = "unwatched";
  } else if (i.interacted) {
    activity = "in-place";
  } else {
    activity = "idle";
  }
  return {
    viewChanges,
    viewChangesUntimed,
    readings,
    presses: i.presses,
    watching: i.watching,
    activity,
  };
}

// ── The words. Authored here so every surface greps to one place. ───────────

/**
 * The console line for a confirmed install that has measured nothing YET
 * because it is a single-page app being used in place. The ordinary
 * "nothing measured yet" line is true but sends this developer looking for a
 * fault; this one names the shape of their app instead.
 *
 * CONTIGUOUS single-quoted run, like every other kit-owned literal: a
 * cross-kit guard greps the shipped source text, so never split it across a
 * concatenation or a line break.
 */
export const NOTHING_MEASURED_IN_PLACE_LINE =
  "[boosthis] Boosthis confirmed this install and has measured nothing yet, and on this page that is the app's shape rather than a fault. A reading is taken when a page view ends, and this app has been used without the address ever changing, so there is no second page view to time: one visit here is one reading, however much a person does. The presses are counted and the reading goes up when this page is left or closed. An app that is simply sitting idle reads differently — this one is being used.";

/** The status-readout line, one per verdict. Counts only; no label ever. */
export function pageActivityStatusLine(f: PageActivityFacts): string {
  const p = `${f.presses} ${f.presses === 1 ? "press" : "presses"}`;
  const r = `${f.readings} ${f.readings === 1 ? "reading" : "readings"}`;
  const untimed =
    f.viewChangesUntimed > 0
      ? ` ${f.viewChangesUntimed} view ${f.viewChangesUntimed === 1 ? "change" : "changes"} could not be timed, and are counted rather than filled in with the first view's number.`
      : "";
  switch (f.activity) {
    case "unwatched":
      return `Activity on this page: cannot tell — this browser gives the kit no way to watch presses, so nothing here says whether the app was used. ${r} taken this visit.${untimed}`;
    case "idle":
      return `Activity on this page: nothing seen — no press and no address change since the kit started, so a low count of readings is an unused page rather than an app the kit cannot see. ${r} taken this visit.`;
    case "in-place":
      return `Activity on this page: ${p}, and the address never changed — this app does its work in place, so the kit has one page view to time however much happens. ${r} taken this visit. That is this app's shape, not a quiet app.${untimed}`;
    default:
      return `Activity on this page: ${p} across ${f.viewChanges} address ${f.viewChanges === 1 ? "change" : "changes"}. ${r} taken this visit — a reading is taken when a page view ends, so an app that stays on one document has far fewer readings than screens.${untimed}`;
  }
}

/** The bubble hero's one-line stat. The count is never dressed up, but on an
 *  app whose work the kit cannot see as page views it no longer stands alone
 *  implying a quiet app.
 *
 *  Both counts come from the TALLY (pageViewTally.ts), never from this
 *  document's own bookkeeping above: the document's numbers are thrown away by
 *  every full navigation, and the panel's headline number may not be. Taking
 *  both from one place also keeps the line in ONE window — a device-wide count
 *  beside a this-page "not timed" would be two scopes in one sentence. The
 *  press count stays this page's on purpose: it describes the page in front of
 *  the reader, and says so. */
export function pageActivityHeroText(
  tally: { measured: number; untimed: number },
  f: PageActivityFacts,
): string {
  const n = tally.measured;
  const base = `${n} page ${n === 1 ? "view" : "views"} measured`;
  if (f.activity === "in-place") {
    return `${base} · ${f.presses} ${f.presses === 1 ? "press" : "presses"} in place`;
  }
  if (f.activity === "navigating" && tally.untimed > 0) {
    return `${base} · ${tally.untimed} not timed`;
  }
  return base;
}

/** @internal test hook — reset module state between hermetic runs. */
export function _resetPageActivityForTests(): void {
  interactionSource = null;
  lastLabel = null;
  viewChanges = 0;
  viewChangesUntimed = 0;
  readings = 0;
}
