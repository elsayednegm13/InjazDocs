/**
 * A VISITOR'S PRESS, AS THE STEP AN ACTION STARTS AT.
 *
 * pageCallTrace.ts joins each call the page makes to the routes it reaches,
 * and until this module every such action started at the CALL. The wait a
 * visitor sits through starts earlier — at the click — and ends later — when
 * the page shows the answer — so the drawing missed exactly the part people
 * feel, and said so under every drawing.
 *
 * What happens now:
 *
 *  - A trusted click or key press OPENS a press. Nothing is sent for it yet,
 *    and nothing is stored on the visitor's device.
 *  - A call the page starts WHILE THAT PRESS IS BEING HANDLED is placed under
 *    it: the browser's current event, at the moment the call starts, is the
 *    press itself or an event the press set off before its handling ended
 *    (the form submission a click on a submit button causes, the input a key
 *    press types). That is the one test. Timing is never used to guess: a
 *    call started a moment later, from a timer, a promise that waited on the
 *    network, or anything else, keeps its own action, exactly as before.
 *  - "Placed under" is the press's TRACE: the press mints a fresh trace id
 *    and only the calls placed under it carry that id, so the trace alone
 *    says which calls the press caused. A call keeps the parent it would
 *    have had (none, normally) and starts at its distance from the press;
 *    the server draws the press as the parent of its own page's top-level
 *    steps in that trace (api-server traceView.ts, assembleSpanTree). Named
 *    as a parent here instead, every reader that leaves presses out — all
 *    the readers of requests — would find each such call's parent missing.
 *  - The press CLOSES a second after its last call finished (so the browser's
 *    own timing of the press has time to arrive), when the page is hidden, or
 *    at PRESS_MAX_OPEN_MS at the latest. Its length runs from the event's own
 *    moment — the first milliseconds of the wait are the ones a busy page
 *    holds a click for — to the last of: its calls finishing, and the next
 *    paint the browser timed after it (Event Timing), where the browser
 *    measured one.
 *  - A press that made NO call sends nothing, whatever its paint. The step
 *    exists to say where an action started, and a press with no call has no
 *    action under it; its paint is already counted where it always was.
 *
 * What the press step carries: the page's route label (the same normalized
 * label every other step from this page carries) and, where the control
 * census is on and names the control, its structural handle
 * (controlHandle.ts). Never the control's text, its test id, anything typed,
 * or where on the screen the press landed — none of those is read here.
 *
 * Budget: the press is paid for out of the same join budget its calls use.
 * The first call placed under a press needs two (the call and the press); a
 * call that finds only one keeps its own action instead. So a page pressed
 * as fast as a person can press it never sends more steps than before.
 *
 * Imports: nothing in the kit's recorded module cycle
 * (lib/kit-module-cycles.json). The span emitter and the census switch
 * arrive through `PressPorts`, from pageCallTrace.ts's own bound ports.
 */

import { isControlHandle } from "./controlHandle";
import { normalizeRouteLabel } from "./partName";
import { beginSpan } from "./spanScope";
import { sanitizeTraceId } from "./trace";
import { kitListen, kitTimeout, outsideAngular } from "./zoneSafe";
import type { SpanRating, TraceSpan } from "./spanEmitter";

/** What the press step borrows, bound by pageCallTrace.ts. */
export interface PressPorts {
  readonly enqueue: (span: TraceSpan) => void;
  readonly rate: (durationMs: number) => SpanRating;
  /** Whether the control census is on: the handle travels only then. */
  readonly censusOn: () => boolean;
}

/** How long a press stays open after its last call finished. */
export const PRESS_SETTLE_MS = 1_000;

/** The longest any press stays open. A call still running then is counted to
 *  the moment the press closed — it was still being waited on. */
export const PRESS_MAX_OPEN_MS = 30_000;

/** The most presses open at once. Only presses with calls under them stay
 *  open past their handling, and each of those paid two join tokens, so this
 *  is a backstop, never the working bound. */
export const MAX_OPEN_PRESSES = 16;

/** The events that open a press. Only these: a pointer going down, a wheel or
 *  a touch is not a press the visitor finished. */
const PRESS_EVENTS = ["click", "keydown"] as const;

/** Events a press sets off while it is being handled. A call started inside
 *  one of these was caused by the press too. */
const FOLLOWER_EVENTS = ["submit", "input", "beforeinput", "change", "keypress"] as const;

type Handle = ReturnType<typeof setTimeout>;

interface OpenPress {
  readonly event: Event;
  readonly name: (typeof PRESS_EVENTS)[number];
  /** The event's own moment on the page clock (performance.now() units). */
  readonly t0: number;
  /** The address when the press happened, kept until the first call names
   *  the page — the press belongs to the page it was made on. */
  readonly pathAtPress: string | null;
  readonly followers: Event[];
  handling: boolean;
  routeLabel: string | null | undefined;
  /** Handed over by the click watch for the control it matched. */
  handle: string | null;
  traceId: string | null;
  spanId: string | null;
  tied: number;
  pending: number;
  lastEnd: number;
  paintEnd: number | null;
  settleTimer: Handle | null;
  capTimer: Handle | null;
  closed: boolean;
}

let installed = false;
let labelNow: (() => string | null) | null = null;
let portsNow: PressPorts | null = null;
const open: OpenPress[] = [];
const listeners: Array<[string, (e: Event) => void]> = [];

function clockMs(): number {
  try {
    const p = (globalThis as { performance?: { now?: unknown } }).performance;
    if (p && typeof p.now === "function") return (p.now as () => number)();
  } catch {
    /* fall through */
  }
  return Date.now();
}

/** The event's own moment on the page clock, or now when the browser gives
 *  none we can trust (an old engine's epoch stamp, a stamp in the future). */
function eventMoment(e: Event): number {
  const now = clockMs();
  const stamp = e.timeStamp;
  return typeof stamp === "number" && Number.isFinite(stamp) && stamp > 0 && stamp <= now + 1
    ? stamp
    : now;
}

function currentPath(): string | null {
  try {
    const loc = (globalThis as { location?: Location }).location;
    return loc && typeof loc.pathname === "string" ? loc.pathname : null;
  } catch {
    return null;
  }
}

/** End of handling: the first task after the press's own. Every event the
 *  press set off synchronously has been dispatched by then. */
function afterHandling(run: () => void): void {
  try {
    if (typeof MessageChannel === "function") {
      outsideAngular(() => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
          channel.port1.onmessage = null;
          run();
        };
        channel.port2.postMessage(0);
      });
      return;
    }
  } catch {
    /* fall through to a timer */
  }
  kitTimeout(run, 0);
}

function forget(press: OpenPress): void {
  press.closed = true;
  if (press.settleTimer !== null) clearTimeout(press.settleTimer);
  if (press.capTimer !== null) clearTimeout(press.capTimer);
  press.settleTimer = null;
  press.capTimer = null;
  const at = open.indexOf(press);
  if (at >= 0) open.splice(at, 1);
}

function openPress(e: Event): OpenPress | null {
  if (!installed || e.isTrusted !== true) return null;
  const name = PRESS_EVENTS.find((n) => n === e.type);
  if (name === undefined) return null;
  const existing = open.find((p) => p.event === e);
  if (existing) return existing;
  const press: OpenPress = {
    event: e,
    name,
    t0: eventMoment(e),
    pathAtPress: currentPath(),
    followers: [],
    handling: true,
    routeLabel: undefined,
    handle: null,
    traceId: null,
    spanId: null,
    tied: 0,
    pending: 0,
    lastEnd: 0,
    paintEnd: null,
    settleTimer: null,
    capTimer: null,
    closed: false,
  };
  open.push(press);
  while (open.length > MAX_OPEN_PRESSES) {
    const oldest = open[0]!;
    if (oldest.tied > 0) closePress(oldest);
    else forget(oldest);
  }
  afterHandling(() => {
    press.handling = false;
    // Nothing was started under it: it has no action, and nothing is kept.
    if (press.tied === 0) forget(press);
  });
  return press;
}

function onPress(e: Event): void {
  try {
    openPress(e);
  } catch {
    // never break the page
  }
}

function onFollower(e: Event): void {
  try {
    for (let i = open.length - 1; i >= 0; i--) {
      const press = open[i]!;
      if (press.handling && !press.closed) {
        if (press.followers.length < 8) press.followers.push(e);
        return;
      }
    }
  } catch {
    // never break the page
  }
}

function onHidden(): void {
  try {
    const hidden =
      typeof document !== "undefined" && document.visibilityState === "hidden";
    if (!hidden) return;
    closeAll();
  } catch {
    // never break the page
  }
}

function closeAll(): void {
  for (const press of [...open]) {
    if (press.tied > 0) closePress(press);
    else forget(press);
  }
}

/**
 * Start watching presses. `label` names the page a call is made from — the
 * same resolver pageCallTrace.ts labels every call with. Idempotent.
 */
export function installPressWatch(label: () => string | null, ports: PressPorts): void {
  labelNow = label;
  portsNow = ports;
  if (installed) return;
  try {
    if (typeof addEventListener !== "function" || typeof window === "undefined") return;
    for (const name of PRESS_EVENTS) listeners.push([name, onPress]);
    for (const name of FOLLOWER_EVENTS) listeners.push([name, onFollower]);
    listeners.push(["pagehide", closeAll]);
    listeners.push(["visibilitychange", onHidden]);
    // On the window, in the first phase: ahead of the page's own handlers, so
    // the press is open before any of them can start a call.
    for (const [name, fn] of listeners) {
      kitListen(window, name, fn as EventListener, true);
    }
    installed = true;
  } catch {
    listeners.length = 0;
  }
}

/** Stop watching. Presses still open are dropped: the kit is letting go. */
export function uninstallPressWatch(): void {
  try {
    for (const [name, fn] of listeners) {
      removeEventListener(name, fn as EventListener, true);
    }
  } catch {
    // teardown never throws
  }
  listeners.length = 0;
  installed = false;
  for (const press of [...open]) forget(press);
}

/** The press the call starting NOW was caused by, or null. */
function pressOfCurrentEvent(): OpenPress | null {
  if (!installed) return null;
  let current: unknown;
  try {
    current = (globalThis as { event?: unknown }).event;
  } catch {
    return null;
  }
  if (current === undefined || current === null) return null;
  for (let i = open.length - 1; i >= 0; i--) {
    const press = open[i]!;
    if (press.closed) continue;
    if (press.event === current) return press;
    if (press.handling && press.followers.includes(current as Event)) return press;
  }
  // A window listener the page added before ours runs first, so a call from
  // it finds its press not opened yet: open it now, on the same event.
  const ev = current as Event;
  if (typeof ev.type === "string" && (PRESS_EVENTS as readonly string[]).includes(ev.type)) {
    return openPress(ev);
  }
  return null;
}

/** A call placed under a press. */
export interface PressTie {
  /** The press's trace, which the call joins. */
  readonly traceId: string;
  /** Milliseconds from the press to this call's start. */
  readonly offsetMs: number;
  /** The call finished (or never will). `declared` waits do not hold the
   *  press open: their length is declared, not waited through. */
  settled(declared: boolean): void;
}

/**
 * Whether the call starting now was caused by a press and, when it was and
 * the budget allows, place it under that press. `budget` is the join budget's
 * remaining count; `spend` takes from it. Null: the call keeps its own action.
 */
export function tieCallToPress(budget: number, spend: (n: number) => void): PressTie | null {
  try {
    const ports = portsNow;
    if (ports === null) return null;
    const press = pressOfCurrentEvent();
    if (press === null || press.closed) return null;
    // The first call pays for the press too.
    const cost = press.tied === 0 ? 2 : 1;
    if (budget < cost) return null;
    if (press.tied === 0) {
      press.routeLabel = pressLabel(press);
      if (press.routeLabel === null) return null;
      press.traceId = sanitizeTraceId(undefined);
      press.spanId = beginSpan({ parentSpanId: null }).spanId;
      press.capTimer = kitTimeout(() => closePress(press), PRESS_MAX_OPEN_MS);
    }
    spend(cost);
    press.tied += 1;
    press.pending += 1;
    if (press.settleTimer !== null) {
      clearTimeout(press.settleTimer);
      press.settleTimer = null;
    }
    const offsetMs = Math.max(0, Math.round(clockMs() - press.t0));
    let done = false;
    return {
      traceId: press.traceId!,
      offsetMs,
      settled(declared: boolean): void {
        if (done) return;
        done = true;
        try {
          if (press.closed) return;
          press.pending = Math.max(0, press.pending - 1);
          if (!declared) press.lastEnd = Math.max(press.lastEnd, clockMs());
          if (press.pending === 0) {
            if (press.settleTimer !== null) clearTimeout(press.settleTimer);
            press.settleTimer = kitTimeout(() => closePress(press), PRESS_SETTLE_MS);
          }
        } catch {
          // never break the page
        }
      },
    };
  } catch {
    return null;
  }
}

/** The page the press was made on. The resolver names it while the address
 *  is still the one pressed on; if the press already moved the address, the
 *  pressed-on address is named by itself (the router's name for a page that
 *  is no longer showing is not something this kit can ask for). */
function pressLabel(press: OpenPress): string | null {
  try {
    const now = currentPath();
    if (press.pathAtPress !== null && now !== press.pathAtPress) {
      return normalizeRouteLabel(press.pathAtPress);
    }
    return labelNow ? labelNow() : null;
  } catch {
    return null;
  }
}

/** The click watch matched this press's control and names it structurally.
 *  Kept only while the press is open; sent only when the census is on. */
export function notePressControl(e: Event, handle: string | null): void {
  try {
    if (!isControlHandle(handle)) return;
    const press = open.find((p) => p.event === e) ?? openPress(e);
    if (press) press.handle = handle;
  } catch {
    // never break the page
  }
}

/** The browser timed an event (Event Timing). When it is one of our open
 *  presses, its paint is the moment the page first answered the press. */
export function notePressPaint(name: string, startTime: number, duration: number): void {
  try {
    if (open.length === 0) return;
    if (!Number.isFinite(startTime) || !Number.isFinite(duration) || duration < 0) return;
    for (const press of open) {
      if (press.closed || press.name !== name) continue;
      if (Math.abs(press.event.timeStamp - startTime) >= 1) continue;
      const end = startTime + duration;
      press.paintEnd = press.paintEnd === null ? end : Math.max(press.paintEnd, end);
      return;
    }
  } catch {
    // never break the observer
  }
}

function closePress(press: OpenPress): void {
  if (press.closed) return;
  const ports = portsNow;
  const tied = press.tied;
  const pending = press.pending;
  forget(press);
  if (ports === null || tied === 0 || press.traceId === null || press.spanId === null) return;
  if (press.routeLabel === null || press.routeLabel === undefined) return;
  try {
    const now = clockMs();
    // A call still running at the close was still being waited on.
    const end = Math.max(
      press.lastEnd,
      press.paintEnd ?? press.t0,
      pending > 0 ? now : press.t0,
    );
    const durationMs = Math.max(0, Math.round(end - press.t0));
    const handle = ports.censusOn() && isControlHandle(press.handle) ? press.handle : null;
    ports.enqueue({
      traceId: press.traceId,
      layer: "web",
      routeLabel: press.routeLabel,
      durationMs,
      startOffsetMs: 0,
      rating: ports.rate(durationMs),
      spanId: press.spanId,
      kind: "press",
      ...(handle !== null ? { control: handle } : {}),
    });
  } catch {
    // never break the page
  }
}

/** Presses currently open — for the kit's own tests only. */
export function _openPressCountForTests(): number {
  return open.length;
}

/** @internal test hook. */
export function _resetPressTraceForTests(): void {
  uninstallPressWatch();
  labelNow = null;
  portsNow = null;
}
