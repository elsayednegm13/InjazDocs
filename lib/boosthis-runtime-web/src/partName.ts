/* ─────────────────────────────────────────────────────────────────────────
 * WHAT A PART OF THE APP IS CALLED — this kit's copy of the one rule.
 *
 * BOOSTHIS_PART_NAME_V1 — shared with lib/part-name-vocabulary.json.
 * Full reasoning: docs/decisions/part-name-one-rule.md.
 *
 * A part is the piece of the app a reading belongs to: a page here, a route
 * on a server kit. At most 100 characters, refused rather than shortened, and
 * never a minted stand-in for a page this kit could not name.
 *
 * WHY ITS OWN MODULE. This kit was already the working model — its page map,
 * inventory and timings all called one normaliser — but that normaliser lived
 * in `vitals.ts`, the module that also ASSEMBLES the kit. Anything needing
 * the rule had to import the assembler, which is how the page map's wire
 * module was pulled into this kit's large module cycle. A rule every half
 * takes belongs in a leaf: this module imports nothing at all, so it has
 * nothing it COULD import that would close a loop.
 *
 * LETTERS BEFORE THE RULE (BOOSTHIS_PART_NAME_LETTERS_V1). A browser hands
 * over a non-Latin address escaped: every Arabic letter arrives as six
 * characters (`ق` is `%D9%82`). Measured as it arrived, a two-word Arabic
 * address passed the bound and was refused, and a shorter one was filed in a
 * form nobody can read. So escaped LETTERS are turned back into letters before
 * the name is measured or shaped, and nothing else is: an escaped space,
 * slash or symbol, an invisible character and any byte that is not valid
 * UTF-8 stay exactly as they arrived. Digits written in Arabic numerals are
 * read as digits by the identifier tests. The server applies the same step on
 * arrival, so an older copy of this kit and this one file a page under one
 * name.
 * ───────────────────────────────────────────────────────────────────────── */

/** Segments that look volatile or identifying collapse to ":id". */
const NUMERIC_SEG = /^\d+$/;
const UUID_SEG =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * A long hex RUN anywhere in the segment, not only a segment that is nothing
 * but hex.
 *
 * The whole-segment form missed every identifier that carries a prefix. Read
 * against real addresses, `/…/snapshot/mcp-2066268df023bf5e9dd7aeb0` came
 * through untouched — a live identifier, in a label that travels — because
 * "mcp-" is not a hex character. A run is the right unit: an identifier
 * stops being opaque when it is glued to a word, not when it is 24 hex
 * characters long.
 *
 * Deliberately not narrowed to a known prefix. Nothing about "mcp" is
 * special; the next identifier shape will carry a different one.
 */
const LONG_HEX_SEG = /[0-9a-f]{16,}/i;
// BOOSTHIS_PART_NAME_V1 — shared with lib/part-name-vocabulary.json.
export const MAX_PART_NAME = 100;

// BOOSTHIS_PART_NAME_LETTERS_V1 — shared with lib/part-name-vocabulary.json
// ("letters"). The same step as the server's `readablePartName`.

/** A run of escaped bytes, decoded together as UTF-8. */
const ESCAPE_RUN = /(?:%[0-9A-Fa-f]{2})+/g;

/**
 * A letter, a combining mark or a number. Built at first use and inside a
 * try: an engine without Unicode property classes keeps every escape as it
 * arrived (today's behaviour) rather than failing to load the kit.
 */
let letterLike: RegExp | null | undefined;
function isLetterLike(cp: number): boolean {
  if (cp < 0x80) return false;
  if (letterLike === undefined) {
    try {
      letterLike = new RegExp("^[\\p{L}\\p{M}\\p{N}]$", "u");
    } catch {
      letterLike = null;
    }
  }
  return letterLike !== null && letterLike.test(String.fromCodePoint(cp));
}

/** One UTF-8 sequence at `bytes[i]`, or null when it is not a valid one
 *  (overlong forms, surrogates, past U+10FFFF, truncated). */
function utf8At(bytes: number[], i: number): { cp: number; len: number } | null {
  const b0 = bytes[i];
  let len: number;
  let cp: number;
  let lo = 0x80;
  let hi = 0xbf;
  if (b0 >= 0xc2 && b0 <= 0xdf) {
    len = 2;
    cp = b0 & 0x1f;
  } else if (b0 >= 0xe0 && b0 <= 0xef) {
    len = 3;
    cp = b0 & 0x0f;
    if (b0 === 0xe0) lo = 0xa0;
    if (b0 === 0xed) hi = 0x9f;
  } else if (b0 >= 0xf0 && b0 <= 0xf4) {
    len = 4;
    cp = b0 & 0x07;
    if (b0 === 0xf0) lo = 0x90;
    if (b0 === 0xf4) hi = 0x8f;
  } else {
    return null;
  }
  if (i + len > bytes.length) return null;
  for (let k = 1; k < len; k += 1) {
    const b = bytes[i + k];
    if (b < (k === 1 ? lo : 0x80) || b > (k === 1 ? hi : 0xbf)) return null;
    cp = (cp << 6) | (b & 0x3f);
  }
  return { cp, len };
}

function decodeRun(run: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < run.length; i += 3) {
    bytes.push(parseInt(run.slice(i + 1, i + 3), 16));
  }
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const seq = bytes[i] >= 0x80 ? utf8At(bytes, i) : null;
    if (seq !== null && isLetterLike(seq.cp)) {
      out += String.fromCodePoint(seq.cp);
      i += seq.len;
    } else {
      out += run.slice(i * 3, i * 3 + 3);
      i += 1;
    }
  }
  return out;
}

/**
 * Escaped letters turned back into letters; everything else exactly as it
 * arrived. A string with no escaped letters comes back unchanged, so every
 * Latin address is named exactly as it was before this step existed.
 */
export function readableLetters(text: string): string {
  if (typeof text !== "string" || text.indexOf("%") < 0) return text;
  return text.replace(ESCAPE_RUN, decodeRun);
}

/** Arabic-Indic and Extended Arabic-Indic digits written as 0–9, for the
 *  identifier tests ONLY — the name keeps the digits it was written in. */
function latinDigits(seg: string): string {
  return seg.replace(/[\u0660-\u0669\u06f0-\u06f9]/g, (d) => {
    const code = d.charCodeAt(0);
    return String(code - (code >= 0x06f0 ? 0x06f0 : 0x0660));
  });
}

/** Escaped letters take at most nine characters per character they become,
 *  so anything longer than this can never fit the bound: refused before any
 *  work is spent on it. */
const MAX_ESCAPED_INPUT = MAX_PART_NAME * 9;

/** Normalize a pathname into a stable, non-identifying route label. */
export function normalizeRouteLabel(pathname: string): string | null {
  if (typeof pathname !== "string") return null;
  if (pathname.length > MAX_ESCAPED_INPUT) return null;
  // Letters before the rule: the bound below measures what a person reads.
  let path = readableLetters(pathname);
  if (path.length === 0) return null;
  if (path.length > MAX_PART_NAME) return null;
  // Never read query string or hash even if handed a full URL-ish string.
  const q = path.search(/[?#]/);
  if (q >= 0) path = path.slice(0, q);
  const segs: string[] = [];
  for (const raw of path.split("/")) {
    let seg = raw;
    // A MATRIX PARAMETER (`/products;sort=price`, Angular's URL syntax, legal
    // in any address) is a value somebody chose, never part of a page's name:
    // each segment is cut at its first `;`. A segment that was nothing but
    // parameters names no page of its own and is dropped, never left empty.
    const semi = seg.indexOf(";");
    if (semi >= 0) {
      seg = seg.slice(0, semi);
      if (!seg) continue;
    }
    const shape = latinDigits(seg);
    if (
      seg &&
      (NUMERIC_SEG.test(shape) ||
        UUID_SEG.test(shape) ||
        LONG_HEX_SEG.test(shape) ||
        seg.includes("@"))
    ) {
      seg = ":id";
    }
    segs.push(seg);
  }
  let label = segs.join("/");
  if (!label.startsWith("/")) label = "/" + label;
  if (label.length > MAX_PART_NAME) return null;
  return label || null;
}
