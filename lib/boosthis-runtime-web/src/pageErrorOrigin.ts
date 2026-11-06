/* ─── Boosthis: whose error is this? (decided on the device) ─────────────
 *
 * The browser hands every uncaught error and unhandled rejection on a page to
 * the page's own listeners, whoever threw it. Browser extensions (password
 * managers, ad blockers, wallets, developer tools) run code inside the page, so
 * their failures arrive on the same path as the app's. Counted as the app's
 * crashes they lower its crash-free reading, raise crash alerts, and reach the
 * developer's AI as faults to fix in code that has none.
 *
 * ONLY THE DEVICE CAN TELL. The crash reporter cuts every file address down to
 * its bare file name before anything leaves the page, so the server receives
 * `content.js` and can never know it came from `chrome-extension://`. This
 * module therefore reads the RAW event file address and the RAW stack, BEFORE
 * any redaction, and returns one closed word. Nothing it reads is kept or sent:
 * no extension id, no name, no file. Only the word (and, upstream, a count)
 * survives, because the list of extensions a person has installed can reveal
 * things about that person.
 *
 * THE RULE:
 *   • "extension" — the throwing file and EVERY stack frame that names an
 *     address come from an extension address. Set aside, counted, never a crash.
 *   • "page"      — at least one frame (or the throwing file) is the page's own
 *     code. Recorded as a crash: an extension that wraps fetch or event
 *     listeners must never hide an app bug that ran underneath it.
 *   • "unknown"   — no address at all (a stackless error, a thrown string, a
 *     rejection with no reason). Counted as a crash, exactly as before: the kit
 *     cannot tell where it came from, and a guess would hide real faults.
 *
 * BROWSER NOTICES. "ResizeObserver loop completed with undelivered
 * notifications." (and the older "ResizeObserver loop limit exceeded") is raised
 * by the browser itself as a page error with no error object attached. Nothing
 * broke. It is recognised ONLY by that exact wording with no error object —
 * never by a looser match, which could swallow an app's own error that happens
 * to mention ResizeObserver.
 *
 * DETAILS HIDDEN BY THE BROWSER. "Script error." with no error object means the
 * script was served from another address without the settings that let this
 * page read its errors. It may well be the app's own code on a CDN, so it STAYS
 * counted; it is only marked, so the crash list and the assistant can say why
 * the row is blank and what makes it readable.
 *
 * Pure, synchronous, never throws.
 */

// ── shared judgement: begin (byte-identical in the React Native kit) ──
/** The closed answer to "whose error is this?". */
export type PageErrorOrigin = "extension" | "page" | "unknown";

/** Every scheme a browser uses for code an extension put into the page.
 *  `webkit-masked-url://hidden/` is the address Safari substitutes for an
 *  extension script in stacks, so a Safari extension's frames read as this
 *  rather than as `safari-web-extension://`. */
const EXTENSION_SCHEME =
  /^(?:chrome-extension|moz-extension|safari-extension|safari-web-extension|ms-browser-extension|extension|webkit-masked-url):\/\//i;

/** Any absolute address inside a stack line: `scheme://…` up to the first
 *  space or closing parenthesis. A `blob:https://site/…` address matches at its
 *  inner `https://`, which is the page's own origin — correctly the page. */
const ADDRESS_IN_LINE = /[a-z][a-z0-9+.-]*:\/\/[^\s()]+/gi;

/** The same, as a yes/no with no global state to reset. */
const HAS_ADDRESS = /[a-z][a-z0-9+.-]*:\/\//i;

/** A V8 (Chrome, Edge, Opera, Brave) frame line: `    at fn (url:1:2)`. */
const V8_FRAME = /^\s*at\s/;

/** Is this one address an extension's? */
export function isExtensionAddress(address: string): boolean {
  return EXTENSION_SCHEME.test(address.trim());
}

/** "ext" | "page" | null (the address-free frame says nothing). */
function classifyLine(line: string): "ext" | "page" | null {
  const found = line.match(ADDRESS_IN_LINE);
  if (!found || found.length === 0) return null;
  // A line naming the page anywhere (an eval frame names both the evaluated
  // code and the frame that created it) belongs to the page: one page address
  // is enough to keep the error counted.
  for (const address of found) {
    if (!isExtensionAddress(address)) return "page";
  }
  return "ext";
}

/** Only the FRAME lines of a stack. V8 prefixes its stack with the error's
 *  own message, which can quote any address the app likes; SpiderMonkey
 *  (Firefox) and JavaScriptCore (Safari) stacks are frames only, each
 *  `function@address:line:column`. */
function frameLines(stack: string): string[] {
  const lines = stack.split("\n");
  if (lines.some((l) => V8_FRAME.test(l))) {
    return lines.filter((l) => V8_FRAME.test(l));
  }
  return lines.filter((l) => l.includes("@"));
}

/**
 * Decide whose error this is from the raw file address the error event named
 * (absent for a rejection) and the raw stack. MUST be called before any
 * address is redacted; returns only the closed word.
 */
export function judgePageErrorOrigin(
  filename: unknown,
  stack: unknown,
): PageErrorOrigin {
  try {
    let sawExtension = false;
    if (typeof filename === "string" && filename.trim() !== "") {
      if (isExtensionAddress(filename)) sawExtension = true;
      else if (HAS_ADDRESS.test(filename)) return "page";
    }
    if (typeof stack === "string" && stack !== "") {
      for (const line of frameLines(stack.slice(0, 16_384))) {
        const verdict = classifyLine(line);
        if (verdict === "page") return "page";
        if (verdict === "ext") sawExtension = true;
      }
    }
    return sawExtension ? "extension" : "unknown";
  } catch {
    // A judgement that cannot be made keeps the error counted.
    return "unknown";
  }
}

/** The raw stack of whatever was thrown, read without touching anything a
 *  host getter could throw from. Never redacted here, never kept. */
export function rawStackOf(thrown: unknown): string | undefined {
  try {
    if (thrown && typeof thrown === "object" && "stack" in thrown) {
      const s = (thrown as { stack?: unknown }).stack;
      return typeof s === "string" ? s : undefined;
    }
  } catch {
    /* a hostile getter keeps the error counted */
  }
  return undefined;
}

// ── shared judgement: end ──

/** The two browser notices, by their exact wording. Anything else — a prefix,
 *  a suffix, another capitalisation — is an error like any other. */
export const BROWSER_NOTICE_MESSAGES: readonly string[] = [
  "ResizeObserver loop completed with undelivered notifications.",
  "ResizeObserver loop limit exceeded",
];

/** True only for an error event carrying NO error object whose message is
 *  exactly one of the browser's notices. */
export function isBrowserNotice(errorObject: unknown, message: unknown): boolean {
  if (errorObject !== undefined && errorObject !== null) return false;
  return typeof message === "string" && BROWSER_NOTICE_MESSAGES.includes(message);
}

/** The browser's wording when it hides a cross-origin script's error. */
export const HIDDEN_DETAILS_MESSAGE = "Script error.";

/**
 * The error name a "details hidden" crash travels under.
 *
 * The browser gives no error object, so there is no real name to send; this
 * closed, code-defined token stands in for it. It keeps these rows in a group
 * of their own (rather than pooled with every other stackless error) and lets
 * the server attach the explanation — the crossorigin attribute on the script
 * tag and the matching cross-origin header on the server hosting the script —
 * wherever the row is shown. The server recognises it only together with an
 * empty frame, so an app's own class of the same name is never relabelled.
 */
export const HIDDEN_DETAILS_ERROR_NAME = "CrossOriginScriptError";

/** True for an error event the browser stripped for crossing origins. */
export function isHiddenDetailsError(
  errorObject: unknown,
  message: unknown,
): boolean {
  if (errorObject !== undefined && errorObject !== null) return false;
  return message === HIDDEN_DETAILS_MESSAGE;
}
