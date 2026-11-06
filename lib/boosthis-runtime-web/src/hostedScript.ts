/** The pre-built, hosted one-line install — WRITTEN DOWN ONCE.
 *
 * WHY THIS FILE EXISTS
 * The web runtime ships as TypeScript modules, which need a bundler. Projects
 * without one (a single `index.html`, a page produced in a chat, a hosted
 * no-code site) install the SAME runtime as a pre-built script tag instead.
 * That address used to be written out by hand in every place that mentions it:
 * the AI-facing install guide, the dashboard's setup page, the scan script, a
 * comment in `tag.ts`. An installer who never reached the guide could not find
 * it at all, invented `https://cdn.boosthis.com/boosthis.js`, and the page
 * measured nothing — the browser answered ERR_NAME_NOT_RESOLVED and no startup
 * line was ever printed.
 *
 * So the address, and the `onerror` handler that has to travel with it, are
 * stated here and nowhere else. Every copy that reaches a reader is either
 * built from these constants or checked against them
 * (`artifacts/api-server/src/routes/__tests__/kitTag.test.ts`), so the shipped
 * copy and the served guide cannot drift into two different addresses.
 *
 * Dependency-free and DOM-free on purpose: this module is imported by the
 * server-only kit builder (`integrationKit.ts`), which is typechecked with no
 * `dom` lib inside the api-server, and it ships with the kit so the address
 * arrives with the bytes.
 */

/** The pre-built browser runtime, served by the Boosthis API server at
 *  `GET /kit.js`. This is the ONLY address a page with no build step needs. */
export const HOSTED_KIT_SCRIPT_URL = "https://www.boosthis.com/kit.js";

/** The `onerror` handler pasted onto the script tag. It is the only piece of
 *  Boosthis that lives in the developer's own page, so it is the only thing
 *  that can speak when the kit file never arrives — without it, a blocked or
 *  mistyped address looks exactly like a page with nothing installed. */
export const HOSTED_KIT_TAG_ONERROR =
  "console.error('[boosthis] Boosthis did not load: '+this.src+' never " +
  "arrived, so nothing is measuring. Check the address, the network, and any " +
  "Content-Security-Policy.')";

/** The whole line, with the three values a developer fills in left as
 *  placeholders. Used verbatim by the served install guide and by the
 *  quickstart that ships inside the kit archive. */
export const HOSTED_KIT_SCRIPT_TAG =
  `<script defer src="${HOSTED_KIT_SCRIPT_URL}" ` +
  `data-key="<the project key>" ` +
  `data-install="<a UUID v4 you generate ONCE>" ` +
  `data-project="<friendly name>" ` +
  `onerror="${HOSTED_KIT_TAG_ONERROR}"></script>`;

/* ─── The optional early line ───────────────────────────────────────────
 *
 * The kit starts after the page's own code, so an error thrown before it
 * loads used to be missed. This line, pasted FIRST in the page's <head>,
 * listens — passively, never `preventDefault()` — for the window's errors and
 * unhandled rejections, and keeps the first 50 of them in memory under
 * `window.__boosthisEarly`. When the kit's crash reporter starts
 * it adds its own listeners, takes the kept ones (judged exactly as live
 * ones), removes the early listeners and lets the queue go.
 *
 * It stores nothing on the visitor's device and sends nothing anywhere. It is
 * OPTIONAL: a page without it, or whose Content-Security-Policy blocks inline
 * scripts, works exactly as before. A policy can allow this one line by its
 * hash, EARLY_ERRORS_SCRIPT_CSP_SOURCE, which is the hash of these exact
 * bytes — reformatting the line changes the hash. A test recomputes it.
 */

/** Where the early line leaves what it kept, for the kit to take. */
export const EARLY_ERRORS_GLOBAL = "__boosthisEarly";

/** The line's script, exactly. Plain ES5, single quotes only, so it can sit
 *  in an HTML file or inside a double-quoted string in a framework's layout.
 *  It keeps at most 50 errors; the kit reads no more than that
 *  (crashReporter.ts, EARLY_ERRORS_READ_MAX — a test holds the two equal).
 *  String pieces only: the kit packer reads this file's constants as text. */
export const EARLY_ERRORS_SCRIPT_BODY =
  `(function(w){if(w.${EARLY_ERRORS_GLOBAL})return;var q=[],k=function(t){return function(e){` +
  "if(q.length<50)q.push([t,Date.now(),t==='r'?e.reason:e.error,e.message,e.filename,e.lineno,e.colno])}}," +
  "a=k('e'),b=k('r');w.addEventListener('error',a);w.addEventListener('unhandledrejection',b);" +
  `w.${EARLY_ERRORS_GLOBAL}={q:q,stop:function(){w.removeEventListener('error',a);` +
  "w.removeEventListener('unhandledrejection',b)}}})(window)";

/** The whole line, as pasted first in <head>. */
export const EARLY_ERRORS_SCRIPT_TAG = `<script>${EARLY_ERRORS_SCRIPT_BODY}</script>`;

/** The source expression a Content-Security-Policy `script-src` names to
 *  allow the line and nothing else inline. */
export const EARLY_ERRORS_SCRIPT_CSP_SOURCE = "'sha256-9UdX4xPciW2jk3+vDWSk6J+9fM7mn1C9yTgUOfZp9Ik='";
