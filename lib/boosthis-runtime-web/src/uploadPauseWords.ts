/**
 * The words for a wait Boosthis asked for — ONE source for the panel notice
 * and the status readout, so the two can never tell it differently.
 *
 * A 429 is not a refusal. Nothing about the batch was judged: the install has
 * used its upload allowance for the moment and Boosthis said how long to wait.
 * The kit holds what it was about to send and sends it after the wait
 * (uploadPacing.ts). So the refusal words ("Refused — batch rejected",
 * "Uploads lost") never describe it, and neither do the network-failure words:
 * Boosthis answered.
 *
 * What the kit drops ITSELF while holding data (more than it can keep, or held
 * too long to send) is a separate count, said in the kit's own words — never
 * folded into the server's refusals.
 *
 * Every byte is authored here: no server text, no install id, no developer
 * string. The end time is derived on this device from the wait Boosthis
 * stated, never quoted from a reply.
 */

export const UPLOAD_PAUSE_TITLE = "Paused \u2014 Boosthis asked this app to wait";

export const UPLOAD_PAUSE_BODY =
  "This is a pause Boosthis asked for, not a refusal: this install has used " +
  "its upload allowance for the moment, so nothing is sent from any tab " +
  "until the wait is over. Nothing was rejected \u2014 what this app was " +
  "about to send stays on this device and goes out by itself when the pause " +
  "ends.";

/** The status readout's row label for when the pause ends. */
export const UPLOAD_PAUSE_ENDS_LABEL = "Pause ends";

/** The status readout's row label for the kit's own drops. */
export const HELD_DROPPED_LABEL = "Dropped by this kit while holding data";

/** "14:03:05 (in about 45 seconds)" — the device's own clock, so the time
 *  reads the way the developer's clock does. */
export function uploadPauseEndsText(until: number, now: number = Date.now()): string {
  const at = new Date(until);
  const clock = [at.getHours(), at.getMinutes(), at.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
  return `${clock} (${inAbout(until - now)})`;
}

function inAbout(ms: number): string {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  if (seconds < 90) return `in about ${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.round(seconds / 60);
  return `in about ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/** The panel's sentence for the pause's end. */
export function uploadPauseEndsSentence(until: number, now: number = Date.now()): string {
  return `The pause ends at ${uploadPauseEndsText(until, now)}.`;
}

/** The kit's own drops, in its own words — never a refusal by Boosthis. */
export function heldDroppedSentence(count: number): string {
  const n = Math.max(0, Math.round(count));
  return (
    `This kit dropped ${n} held measurement${n === 1 ? "" : "s"} itself ` +
    "\u2014 more than it could keep on this device while waiting, or held too " +
    "long to send. Boosthis refused none of them."
  );
}

/** The status readout's row label for the share of visits samples and spans
 *  come from, shown only while that share is less than every visit. */
export const VISIT_SHARE_LABEL = "Samples and spans";

/**
 * While many people are on the site at once, Boosthis asks for samples and
 * spans from about 1 in N visits (the same share the dashboard and the
 * assistant-facing reading state). `thisVisit` says whether this visit is one
 * of them, or null when it has not been decided yet — so a developer whose own
 * visit was not chosen reads why it sends none, not a broken kit.
 */
export function visitShareSentence(oneIn: number, thisVisit: boolean | null): string {
  const n = Math.max(2, Math.round(oneIn));
  const which =
    thisVisit === true
      ? " This visit is one of them."
      : thisVisit === false
        ? " This visit is not one of them, so it sends none; crash reports are still sent from every visit."
        : "";
  return (
    `measured from about 1 in ${n} visits, because more people are on this ` +
    `site at once than the upload allowance carries in full.${which}`
  );
}
