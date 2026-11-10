/**
 * W2 quotation PDF renderer (D-06) — dependency-free, runs inside the Worker.
 *
 * Layout: A4 portrait 595.28x841.89 pt. Fixed band layout: header band with
 * the document label and the company name, an info block (quote number,
 * revision, status, issued/valid dates, case reference, incoterm), a buyer
 * block, an items table with wrapped Arabic/Latin cells, the subtotal,
 * payment terms and notes, and a footer with page numbers. A draft is
 * watermarked on every page so it can never be mistaken for a sent document.
 *
 * Shaping: Arabic letters are drawn as vector paths from AR_FONT — outlines
 * baked once by scripts/w2/gen-ar-glyphs.cjs into
 * src/features/quotations/ar-glyphs.generated.ts (no font file, no fs and no
 * network access at request time; workerd has no host font files). Latin
 * text and digits use the PDF base-14 Helvetica with WinAnsiEncoding.
 *
 * Geometry uses binary floats freely; money is computed elsewhere with
 * bigint (quotations.ts) and arrives here as integer cents — floats never
 * decide money. The renderer is a pure function of its inputs.
 *
 * Excluded by design (D-06): bank data, personal phones, ID numbers, tax
 * figures, technical IDs (UUIDs, provenance ids) and audit fields — the
 * snapshot type carries none of them.
 */
import { AR_FONT } from "../../src/features/quotations/ar-glyphs.generated";

export type QuotationPdfItem = {
  position: number;
  description: string;
  quantityText: string;
  unitLabel: string;
  unitPriceText: string;
  lineTotalMinor: number;
  sourceQuotationId?: string;
  sourceItemId?: string;
  sourceLineTotalMinor?: number;
};

export type QuotationPdfSnapshot = {
  quoteNumber: string;
  revision: number;
  status: string;
  issuedAt: string;
  validUntil: string;
  companyName: string;
  customerName: string;
  customerAddress: string;
  caseReference: string;
  currency: string;
  subtotalMinor: number;
  paymentTerms: string;
  notes: string;
  incoterm: string;
  items: QuotationPdfItem[];
  validityDays?: number;
};

/* ------------------------------------------------------------------ page -- */

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 48;
const BAND_H = 58;
const BOTTOM_LIMIT = 52;
const CONTENT_W = PAGE_W - 2 * MARGIN; // 499.28

const INK: [number, number, number] = [0.13, 0.15, 0.17];
const MUTED: [number, number, number] = [0.45, 0.48, 0.52];
const BRAND: [number, number, number] = [0.11, 0.19, 0.35];
const LIGHT: [number, number, number] = [0.88, 0.9, 0.93];
const ZEBRA: [number, number, number] = [0.955, 0.963, 0.973];
const RULE: [number, number, number] = [0.82, 0.84, 0.87];
const WATERMARK_C: [number, number, number] = [0.76, 0.77, 0.79];
const WHITE: [number, number, number] = [1, 1, 1];

const COMPANY = 15;
const BAND_LABEL = 9;
const WATERMARK_SIZE = 40;

/* ------------------------------------------------- Helvetica (WinAnsi) --- */

/** Glyph advance widths per 1000 units, WinAnsi byte → width. */
const HELVETICA_W: Record<number, number> = {
  32: 278, 33: 278, 34: 355, 35: 556, 36: 556, 37: 889, 38: 667, 39: 191,
  40: 333, 41: 333, 42: 389, 43: 584, 44: 278, 45: 333, 46: 278, 47: 278,
  48: 556, 49: 556, 50: 556, 51: 556, 52: 556, 53: 556, 54: 556, 55: 556,
  56: 556, 57: 556,
  58: 278, 59: 278, 60: 584, 61: 584, 62: 584, 63: 556, 64: 1015,
  65: 667, 66: 667, 67: 722, 68: 722, 69: 667, 70: 611, 71: 778, 72: 722,
  73: 278, 74: 500, 75: 667, 76: 556, 77: 833, 78: 722, 79: 778, 80: 667,
  81: 778, 82: 722, 83: 667, 84: 611, 85: 722, 86: 667, 87: 944, 88: 667,
  89: 667, 90: 611,
  91: 278, 92: 278, 93: 278, 94: 469, 95: 556, 96: 333,
  97: 556, 98: 556, 99: 500, 100: 556, 101: 556, 102: 278, 103: 556,
  104: 556, 105: 222, 106: 222, 107: 500, 108: 222, 109: 833, 110: 556,
  111: 556, 112: 556, 113: 556, 114: 333, 115: 500, 116: 278, 117: 556,
  118: 500, 119: 722, 120: 500, 121: 500, 122: 500,
  123: 278, 124: 278, 125: 278, 126: 584,
  133: 1000,
  145: 191, 146: 222, 147: 333, 148: 333, 149: 350, 150: 556, 151: 1000,
  152: 333, 153: 1000,
  160: 278, 161: 333, 162: 556, 163: 556, 164: 556, 165: 556, 166: 260,
  167: 556, 168: 333, 169: 737, 170: 370, 171: 556,
  174: 737, 176: 400, 177: 584, 178: 333, 179: 333, 180: 333, 181: 556,
  183: 350, 184: 333, 185: 333, 186: 365, 187: 556,
  188: 834, 189: 834, 190: 834,
  215: 584, 223: 556, 237: 222, 239: 222, 243: 556, 247: 584, 249: 556,
};

const WINANSI_SPECIAL: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92,
  0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c,
  0x017e: 0x9e, 0x0178: 0x9f,
};

/** Latin text → WinAnsi single-byte string (unknown codepoints become "?"). */
function winAnsiBytes(text: string): string {
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 63;
    const special = WINANSI_SPECIAL[cp];
    if (special !== undefined) {
      out += String.fromCharCode(special);
      continue;
    }
    out += (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) ? String.fromCharCode(cp) : "?";
  }
  return out;
}

function latinWidth(text: string, size: number): number {
  const bytes = winAnsiBytes(text);
  let units = 0;
  for (let i = 0; i < bytes.length; i += 1) units += HELVETICA_W[bytes.charCodeAt(i)] ?? 556;
  return (units * size) / 1000;
}

function pdfEscape(text: string): string {
  let out = "";
  for (const ch of text) out += ch === "(" || ch === ")" || ch === "\\" ? "\\" + ch : ch;
  return out;
}

/* --------------------------------------------------- baked Arabic glyphs -- */

type BakedGlyph = { w: number; c: readonly (readonly number[])[] };
const GLYPHS = AR_FONT.glyphs as unknown as Record<string, BakedGlyph | undefined>;
const UP_EM = AR_FONT.unitsPerEm;

function glyphFor(cp: number): BakedGlyph | null {
  return GLYPHS[cp.toString(16).toUpperCase().padStart(4, "0")] ?? null;
}

function arabicWidth(cp: number, size: number): number {
  return ((glyphFor(cp)?.w ?? 0) * size) / UP_EM;
}

/* --------------------------------------------------------------- shaping -- */

const LAM = 0x0644;

/** Right-joining letters (never pass a join forward to the next letter). */
const JOIN_A = new Set([
  0x0622, 0x0623, 0x0625, 0x0627, 0x0629,
  0x062f, 0x0630, 0x0631, 0x0632, 0x0648, 0x0649,
]);

/** Diacritics are stripped before shaping (the commercial text is unvowelled). */
const STRIP = new Set<number>();
for (let c = 0x064b; c <= 0x065f; c += 1) STRIP.add(c);
STRIP.add(0x0670);

/** base letter → [isolated, final, initial?, medial?] presentation codepoints. */
const FORMS: Record<number, [number, number, number?, number?]> = {
  0x0621: [0xfe76, 0xfe77, 0xfe78, 0xfe79],
  0x0622: [0xfe80, 0xfe81],
  0x0623: [0xfe82, 0xfe83],
  0x0624: [0xfe84, 0xfe85],
  0x0625: [0xfe86, 0xfe87],
  0x0626: [0xfe88, 0xfe89, 0xfe8a, 0xfe8b],
  0x0627: [0xfe8c, 0xfe8d],
  0x0628: [0xfe8e, 0xfe8f, 0xfe90, 0xfe91],
  0x0629: [0xfe92, 0xfe93],
  0x062a: [0xfe94, 0xfe95, 0xfe96, 0xfe97],
  0x062b: [0xfe98, 0xfe99, 0xfe9a, 0xfe9b],
  0x062c: [0xfe9c, 0xfe9d, 0xfe9e, 0xfe9f],
  0x062d: [0xfea0, 0xfea1, 0xfea2, 0xfea3],
  0x062e: [0xfea4, 0xfea5, 0xfea6, 0xfea7],
  0x062f: [0xfea8, 0xfea9],
  0x0630: [0xfeaa, 0xfeab],
  0x0631: [0xfeac, 0xfead],
  0x0632: [0xfeae, 0xfeaf],
  0x0633: [0xfeb0, 0xfeb1, 0xfeb2, 0xfeb3],
  0x0634: [0xfeb4, 0xfeb5, 0xfeb6, 0xfeb7],
  0x0635: [0xfeb8, 0xfeb9, 0xfeba, 0xfebb],
  0x0636: [0xfebc, 0xfebd, 0xfebe, 0xfebf],
  0x0637: [0xfec0, 0xfec1],
  0x0638: [0xfec2, 0xfec3],
  0x0639: [0xfec4, 0xfec5, 0xfec6, 0xfec7],
  0x063a: [0xfec8, 0xfec9, 0xfeca, 0xfecb],
  0x0641: [0xfecc, 0xfecd, 0xfece, 0xfecf],
  0x0642: [0xfed0, 0xfed1, 0xfed2, 0xfed3],
  0x0643: [0xfed4, 0xfed5, 0xfed6, 0xfed7],
  0x0644: [0xfed8, 0xfed9, 0xfeda, 0xfedb],
  0x0645: [0xfedc, 0xfedd, 0xfede, 0xfedf],
  0x0646: [0xfee0, 0xfee1, 0xfee2, 0xfee3],
  0x0647: [0xfee4, 0xfee5, 0xfee6, 0xfee7],
  0x0648: [0xfee8, 0xfee9],
  0x0649: [0xfeea, 0xfeeb],
  0x064a: [0xfeec, 0xfeed, 0xfeee, 0xfeef],
  0x0640: [0xfe74, 0xfe74, 0xfe74, 0xfe74],
};

/** lam + alefX → [isolated, final] lam-alef composites. */
const LAM_ALEF: Record<number, [number, number]> = {
  0x0622: [0xfef5, 0xfef6],
  0x0623: [0xfef7, 0xfef8],
  0x0625: [0xfef9, 0xfefa],
  0x0627: [0xfefb, 0xfefc],
};

const isJoiningLetter = (cp: number): boolean => FORMS[cp] !== undefined || JOIN_A.has(cp);

/** Fallback chain for a wanted shape: wanted → isolated → base letter → skip. */
function resolveForm(wanted: number | undefined, isolated?: number, base?: number): number {
  for (const candidate of [wanted, isolated, base]) {
    if (candidate !== undefined && glyphFor(candidate)) return candidate;
  }
  return 0;
}

type ArSegment = { kind: "letters" | "digits"; glyphs: number[] };
type ShapedToken = { kind: "ar"; segments: ArSegment[] } | { kind: "lat"; text: string };

function isArabicCp(cp: number): boolean {
  return (cp >= 0x0621 && cp <= 0x064a) || (cp >= 0x0660 && cp <= 0x066d);
}

/** Split text into script tokens; spaces are word gaps, diacritics vanish. */
function tokenize(text: string): ShapedToken[] {
  const tokens: ShapedToken[] = [];
  let ar: number[] = [];
  let lat = "";
  const flush = (): void => {
    if (ar.length) {
      tokens.push(shapedAr(ar));
      ar = [];
    }
    if (lat) {
      tokens.push({ kind: "lat", text: lat });
      lat = "";
    }
  };
  for (const raw of text) {
    const cp = raw.codePointAt(0) ?? 0;
    if (STRIP.has(cp)) continue;
    if (isArabicCp(cp)) {
      if (lat) flush();
      ar.push(cp);
      continue;
    }
    if (raw === " " || raw === "\t" || raw === "\n" || raw === "\r") {
      flush();
      continue;
    }
    if (ar.length) flush();
    lat += raw;
  }
  flush();
  return tokens;
}

/** Shape one Arabic token (logical order) into presentation segments. */
function shapedAr(cps: number[]): ShapedToken {
  const segments: ArSegment[] = [];
  const flushPending = (): void => {
    if (letters.length) segments.push({ kind: "letters", glyphs: letters });
    if (digits.length) segments.push({ kind: "digits", glyphs: digits });
  };
  let letters: number[] = [];
  let digits: number[] = [];
  let prevLink = false; // the previous letter joins forward (dual-joining)
  for (let i = 0; i < cps.length; i += 1) {
    const cp = cps[i];
    if (cp === LAM && LAM_ALEF[cps[i + 1] ?? 0] !== undefined) {
      flushPending();
      letters = [];
      digits = [];
      const pair = LAM_ALEF[cps[i + 1]];
      const composite = resolveForm(prevLink ? pair[1] : pair[0], pair[0], 0x0627);
      if (composite) segments.push({ kind: "letters", glyphs: [composite] });
      i += 1; // the alef is consumed by the composite
      prevLink = false;
      continue;
    }
    if (cp >= 0x0660 && cp <= 0x0669) {
      // Arabic-Indic digits are direct glyphs and always read left-to-right.
      if (letters.length) flushPending();
      letters = [];
      digits.push(cp);
      prevLink = false;
      continue;
    }
    if (cp >= 0x066a && cp <= 0x066d) {
      flushPending();
      letters = [];
      digits = [];
      if (glyphFor(cp)) segments.push({ kind: "letters", glyphs: [cp] });
      prevLink = false;
      continue;
    }
    if (isJoiningLetter(cp)) {
      const nextLink = isJoiningLetter(cps[i + 1] ?? 0);
      const forms = FORMS[cp]!;
      const wanted = prevLink && nextLink ? forms[3] : prevLink ? forms[1] : nextLink ? forms[2] : forms[0];
      const resolved = resolveForm(wanted, forms[0], cp);
      if (resolved) {
        if (digits.length) flushPending(); // keep the logical order digits → letters
        letters.push(resolved);
      }
      prevLink = resolved !== 0 && !JOIN_A.has(cp);
      continue;
    }
    // Unknown Arabic codepoint without a baked glyph: renders nothing and
    // breaks joining, exactly like a non-joining separator would.
    flushPending();
    letters = [];
    digits = [];
    prevLink = false;
  }
  flushPending();
  return { kind: "ar", segments };
}

/* -------------------------------------------------------------- wrapping -- */

type Line = { tokens: ShapedToken[]; width: number; rtl: boolean };

function tokenWidth(token: ShapedToken, size: number): number {
  if (token.kind === "lat") return latinWidth(token.text, size);
  let units = 0;
  for (const segment of token.segments) for (const cp of segment.glyphs) units += glyphFor(cp)?.w ?? 0;
  return (units * size) / UP_EM;
}

function arToken(glyphs: number[]): ShapedToken {
  return { kind: "ar", segments: [{ kind: "letters", glyphs }] };
}

/** One token wider than the column → sequential pieces. */
function splitToken(token: ShapedToken, size: number, maxWidth: number): ShapedToken[] {
  const pieces: ShapedToken[] = [];
  if (token.kind === "lat") {
    let chunk = "";
    let chunkWidth = 0;
    for (const ch of token.text) {
      const charWidth = latinWidth(ch, size);
      if (chunk && chunkWidth + charWidth > maxWidth) {
        pieces.push({ kind: "lat", text: chunk });
        chunk = "";
        chunkWidth = 0;
      }
      chunk += ch;
      chunkWidth += charWidth;
    }
    if (chunk) pieces.push({ kind: "lat", text: chunk });
    return pieces;
  }
  let chunk: number[] = [];
  let chunkWidth = 0;
  for (const segment of token.segments) {
    for (const cp of segment.glyphs) {
      const glyphWidth = arabicWidth(cp, size);
      if (chunk.length && chunkWidth + glyphWidth > maxWidth) {
        pieces.push(arToken(chunk));
        chunk = [];
        chunkWidth = 0;
      }
      chunk.push(cp);
      chunkWidth += glyphWidth;
    }
  }
  if (chunk.length) pieces.push(arToken(chunk));
  return pieces;
}

/** Wrap a paragraph at word boundaries (each token is one word here). */
function wrapLines(text: string, size: number, maxWidth: number): Line[] {
  const tokens = tokenize(text);
  const rtl = tokens.some((token) => token.kind === "ar");
  const spaceWidth = (278 * size) / 1000;
  const lines: Line[] = [];
  let current: ShapedToken[] = [];
  let currentWidth = 0;
  const flush = (): void => {
    if (!current.length) return;
    lines.push({ tokens: current, width: currentWidth, rtl });
    current = [];
    currentWidth = 0;
  };
  for (const token of tokens) {
    const width = tokenWidth(token, size);
    const pieces = width > maxWidth ? splitToken(token, size, maxWidth) : [token];
    for (const piece of pieces) {
      const pieceWidth = tokenWidth(piece, size);
      if (current.length && currentWidth + spaceWidth + pieceWidth > maxWidth) flush();
      if (current.length) currentWidth += spaceWidth;
      current.push(piece);
      currentWidth += pieceWidth;
    }
  }
  flush();
  return lines;
}

/* -------------------------------------------------------------- drawing -- */

function fmt(v: number): string {
  return (Math.round(v * 100) / 100).toFixed(2);
}

/** Quadratic (P0, C, P1) → PDF cubic `c` op (controls at thirds). */
function quadOps(x1: number, y1: number, cx: number, cy: number, x2: number, y2: number): string {
  const c1x = x1 + (2 / 3) * (cx - x1);
  const c1y = y1 + (2 / 3) * (cy - y1);
  const c2x = x2 + (2 / 3) * (cx - x2);
  const c2y = y2 + (2 / 3) * (cy - y2);
  return ` ${fmt(c1x)} ${fmt(c1y)} ${fmt(c2x)} ${fmt(c2y)} ${fmt(x2)} ${fmt(y2)} c`;
}

/** TrueType contour (flat x,y,on triples) → closed path ops (absolute). */
function contourOpsAbs(contour: readonly number[], x0: number, y0: number, s: number): string {
  const n = contour.length / 3;
  if (n < 2) return "";
  const px = (i: number): number => x0 + contour[(((i % n) + n) % n) * 3] * s;
  const py = (i: number): number => y0 + contour[(((i % n) + n) % n) * 3 + 1] * s;
  const on = (i: number): boolean => contour[(((i % n) + n) % n) * 3 + 2] === 1;
  let first = 0;
  while (first < n && !on(first)) first += 1;
  if (first === n) {
    // All points off-curve: the anchors are the implied midpoints.
    let ops = ` ${fmt((px(0) + px(1)) / 2)} ${fmt((py(0) + py(1)) / 2)} m`;
    let ax = (px(0) + px(1)) / 2;
    let ay = (py(0) + py(1)) / 2;
    for (let i = 1; i <= n; i += 1) {
      const mx = (px(i) + px(i + 1)) / 2;
      const my = (py(i) + py(i + 1)) / 2;
      ops += quadOps(ax, ay, px(i), py(i), mx, my);
      ax = mx;
      ay = my;
    }
    return ops + " h";
  }
  let ops = ` ${fmt(px(first))} ${fmt(py(first))} m`;
  let ax = px(first);
  let ay = py(first);
  for (let i = first + 1; i <= first + n; ) {
    if (on(i)) {
      ops += ` ${fmt(px(i))} ${fmt(py(i))} l`;
      ax = px(i);
      ay = py(i);
      i += 1;
      continue;
    }
    const chain: number[] = [];
    let j = i;
    while (!on(j)) {
      chain.push(j);
      j += 1;
    }
    let cx = ax;
    let cy = ay;
    let t = 0;
    for (; t + 1 < chain.length; t += 1) {
      const mx = (px(chain[t]) + px(chain[t + 1])) / 2;
      const my = (py(chain[t]) + py(chain[t + 1])) / 2;
      ops += quadOps(cx, cy, px(chain[t]), py(chain[t]), mx, my);
      cx = mx;
      cy = my;
    }
    ops += quadOps(cx, cy, px(chain[t]), py(chain[t]), px(j), py(j));
    ax = px(j);
    ay = py(j);
    i = j + 1;
  }
  return ops + " h";
}

/** One baked glyph at (x, y): closed subpath per contour, one fill. */
function glyphPathOps(glyph: BakedGlyph, x: number, y: number, size: number): string {
  const s = size / UP_EM;
  let ops = "";
  for (const contour of glyph.c) ops += contourOpsAbs(contour, x, y, s);
  return ops + " f";
}

function colorOps(color: [number, number, number], fill: boolean): string {
  const [r, g, b] = color;
  return `${fmt(r)} ${fmt(g)} ${fmt(b)} ${fill ? "rg" : "RG"}`;
}

/** Draw shaped tokens left→right from lineLeft; Arabic reads RTL inside. */
function drawTokens(
  out: string[],
  tokens: ShapedToken[],
  lineLeft: number,
  baselineY: number,
  size: number,
  rtl: boolean,
): void {
  let cursor = lineLeft;
  const spaceWidth = (278 * size) / 1000;
  const order = rtl ? [...tokens].reverse() : tokens;
  for (let k = 0; k < order.length; k += 1) {
    if (k > 0) cursor += spaceWidth;
    const token = order[k];
    if (token.kind === "lat") {
      out.push(`BT /F1 ${size} Tf 1 0 0 1 ${fmt(cursor)} ${fmt(baselineY)} Tm (${pdfEscape(winAnsiBytes(token.text))}) Tj ET`);
      cursor += latinWidth(token.text, size);
      continue;
    }
    let glyphOps = "";
    const segments = rtl ? [...token.segments].reverse() : token.segments;
    for (const segment of segments) {
      // Arabic letters always read RTL; digit clusters stay LTR.
      const glyphList = segment.kind === "letters" ? [...segment.glyphs].reverse() : segment.glyphs;
      for (const cp of glyphList) {
        const glyph = glyphFor(cp);
        if (!glyph) continue;
        glyphOps += glyphPathOps(glyph, cursor, baselineY, size);
        cursor += arabicWidth(cp, size);
      }
    }
    if (glyphOps) out.push(glyphOps);
  }
}

type TextOpts = { x: number; y: number; size: number; align: "left" | "right" | "center" };

function tokensWidth(tokens: ShapedToken[], size: number): number {
  let width = 0;
  for (const token of tokens) width += tokenWidth(token, size);
  return width + Math.max(0, tokens.length - 1) * ((278 * size) / 1000);
}

/** One unwrapped line drawn at (x, y) with the requested alignment. */
function drawTextLine(out: string[], text: string, opts: TextOpts): void {
  const tokens = tokenize(text);
  if (!tokens.length) return;
  const width = tokensWidth(tokens, opts.size);
  const lineLeft = opts.align === "left" ? opts.x : opts.align === "right" ? opts.x - width : opts.x - width / 2;
  drawTokens(out, tokens, lineLeft, opts.y, opts.size, tokens.some((token) => token.kind === "ar"));
}

/** Wrapped paragraph drawn right-aligned from the right edge. */
function drawParagraph(out: string[], text: string, rightX: number, topY: number, size: number, maxWidth: number): void {
  for (const line of wrapLines(text, size, maxWidth)) {
    drawTokens(out, line.tokens, rightX - line.width, topY, size, line.rtl);
  }
}

/* --------------------------------------------------- money / date helpers -- */

function groupDigits(digits: string): string {
  let out = "";
  for (let i = 0; i < digits.length; i += 1) {
    const fromRight = digits.length - i;
    out += digits[i];
    if (fromRight > 1 && (fromRight - 1) % 3 === 0) out += ",";
  }
  return out;
}

/** Integer cents → "1,234.56". */
function formatMoney(minor: number): string {
  const value = Math.round(minor);
  const negative = value < 0;
  const abs = Math.abs(value);
  const body = `${groupDigits(String(Math.floor(abs / 100)))}.${String(abs % 100).padStart(2, "0")}`;
  return negative ? `-${body}` : body;
}

/** ISO timestamp → "2026-10-28 21:41 UTC" (or "—" when empty). */
function formatUtc(iso: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const s = date.toISOString();
  return `${s.slice(0, 10)} ${s.slice(11, 16)} UTC`;
}

/* ------------------------------------------------------------ table bands -- */

const COLS: { w: number; align: "center" | "right" }[] = [
  { w: 26, align: "center" },
  { w: 239, align: "right" },
  { w: 55, align: "right" },
  { w: 45, align: "center" },
  { w: 70, align: "right" },
  { w: 64, align: "right" },
];
const COL_X = [MARGIN, 74, 313, 368, 413, 483];
const HEADERS = ["م", "الوصف", "الكمية", "الوحدة", "سعر الوحدة", "الإجمالي"];

class PdfWriter {
  parts: string[] = [];
  pages: string[][] = [];
  y = 0;
  tableHeaderPending = false;

  startPage(): void {
    if (this.parts.length) this.pages.push(this.parts);
    this.parts = [];
    this.y = PAGE_H - BAND_H - 24;
    this.parts.push(
      colorOps(BRAND, true),
      `0 ${fmt(PAGE_H - BAND_H)} ${fmt(PAGE_W)} ${fmt(BAND_H)} re f`,
      colorOps(WHITE, false),
      `BT /F1 ${BAND_LABEL} Tf 1 0 0 1 ${fmt(MARGIN)} ${fmt(PAGE_H - 24)} Tm (${pdfEscape("QUOTATION / PROFORMA")}) Tj ET`,
    );
    if (this.tableHeaderPending) this.drawTableHeader();
  }

  finishPage(): void {
    if (this.parts.length) this.pages.push(this.parts);
    this.parts = [];
  }

  ensure(h: number): void {
    if (this.y - h < BOTTOM_LIMIT) this.startPage();
  }

  drawTableHeader(): void {
    this.ensure(20);
    const y0 = this.y;
    this.parts.push(
      colorOps(LIGHT, true),
      `${fmt(MARGIN)} ${fmt(y0 - 18)} ${fmt(CONTENT_W)} 18 re f`,
      colorOps(RULE, false),
      `1 w ${fmt(MARGIN)} ${fmt(y0 - 18)} m ${fmt(MARGIN + CONTENT_W)} ${fmt(y0 - 18)} l S`,
      colorOps(INK, false),
    );
    HEADERS.forEach((label, k) => {
      if (COLS[k].align === "center") {
        drawTextLine(this.parts, label, { x: COL_X[k] + COLS[k].w / 2, y: y0 - 12.5, size: 8, align: "center" });
      } else {
        drawTextLine(this.parts, label, { x: COL_X[k] + COLS[k].w - 4, y: y0 - 12.5, size: 8, align: "right" });
      }
    });
    this.y = y0 - 18;
  }
}

/* -------------------------------------------------------- page sections -- */

function drawLetterhead(writer: PdfWriter, snapshot: QuotationPdfSnapshot): void {
  const name = snapshot.companyName.trim() || "ExportFlow";
  const tokens = tokenize(name);
  if (!tokens.length) return;
  const size = Math.min(COMPANY, Math.max(10, 30 - name.length * 0.35));
  const width = tokensWidth(tokens, size);
  writer.parts.push(colorOps(WHITE, false));
  drawTokens(writer.parts, tokens, PAGE_W - MARGIN - width, PAGE_H - 24, size, tokens.some((token) => token.kind === "ar"));
}

function drawInfoBlock(writer: PdfWriter, snapshot: QuotationPdfSnapshot): void {
  const rows: [string, string, string][] = [
    ["رقم العرض", "QUOTE NO", snapshot.quoteNumber.trim() || "—"],
    ["المراجعة", "REVISION", snapshot.revision > 0 ? String(snapshot.revision) : "—"],
    ["الحالة", "STATUS", snapshot.status || "—"],
    ["تاريخ الإصدار", "ISSUED", formatUtc(snapshot.issuedAt)],
    ["صالح حتى", "VALID UNTIL", formatUtc(snapshot.validUntil)],
    ["مرجع الحالة", "CASE REF", snapshot.caseReference.trim() || "—"],
    ["شروط التسليم", "INCOTERM", snapshot.incoterm.trim() || "—"],
  ];
  writer.ensure(rows.length * 15 + 16);
  writer.y -= 8;
  for (const [ar, en, value] of rows) {
    writer.y -= 15;
    writer.parts.push(colorOps(INK, false));
    drawTextLine(writer.parts, ar, { x: PAGE_W - MARGIN, y: writer.y, size: 8.5, align: "right" });
    drawTextLine(writer.parts, value, { x: PAGE_W - MARGIN - 150, y: writer.y, size: 8.5, align: "right" });
    writer.parts.push(colorOps(MUTED, false));
    drawTextLine(writer.parts, en, { x: MARGIN, y: writer.y, size: 7, align: "left" });
    drawTextLine(writer.parts, value, { x: MARGIN + 104, y: writer.y, size: 7, align: "left" });
  }
}

function drawBuyerBlock(writer: PdfWriter, snapshot: QuotationPdfSnapshot): void {
  writer.y -= 12;
  const name = snapshot.customerName.trim() || "—";
  const nameLines = wrapLines(name, 10.5, 400);
  const addrLines = snapshot.customerAddress.trim() ? wrapLines(snapshot.customerAddress.trim(), 8.5, 440) : [];
  writer.ensure(24 + (nameLines.length + addrLines.length) * 12);
  writer.parts.push(colorOps(MUTED, false));
  drawTextLine(writer.parts, "العميل / CLIENT", { x: PAGE_W - MARGIN, y: writer.y, size: SMALL_NOTE, align: "right" });
  drawTextLine(writer.parts, "CLIENT", { x: MARGIN, y: writer.y, size: 7, align: "left" });
  writer.parts.push(colorOps(INK, false));
  for (const line of nameLines) {
    writer.y -= 14;
    drawTokens(writer.parts, line.tokens, PAGE_W - MARGIN - line.width, writer.y, 10.5, line.rtl);
  }
  writer.parts.push(colorOps(MUTED, false));
  for (const line of addrLines) {
    writer.y -= 12;
    drawTokens(writer.parts, line.tokens, PAGE_W - MARGIN - line.width, writer.y, 8.5, line.rtl);
  }
}

const SMALL_NOTE = 7.5;

function drawItemsTable(writer: PdfWriter, snapshot: QuotationPdfSnapshot): void {
  writer.y -= 10;
  writer.tableHeaderPending = true;
  writer.drawTableHeader();
  if (!snapshot.items.length) {
    writer.ensure(16);
    writer.y -= 14;
    writer.parts.push(colorOps(MUTED, false));
    drawTextLine(writer.parts, "لا توجد بنود بعد — أضف بنداً واحداً على الأقل قبل الإصدار", { x: PAGE_W - MARGIN, y: writer.y, size: 8.5, align: "right" });
  }
  snapshot.items.forEach((item, index) => {
    const descLines = wrapLines(item.description, 9.5, 231);
    const unitLines = item.unitLabel.trim() ? wrapLines(item.unitLabel, 9.5, 37) : [];
    const count = Math.max(1, descLines.length, unitLines.length);
    const rowHeight = 7 + count * 11;
    writer.ensure(rowHeight + 2);
    if (index % 2 === 1) {
      writer.parts.push(colorOps(ZEBRA, true), `${fmt(MARGIN)} ${fmt(writer.y - rowHeight)} ${fmt(CONTENT_W)} ${fmt(rowHeight)} re f`);
    }
    writer.parts.push(colorOps(INK, false));
    drawTextLine(writer.parts, String(item.position), { x: COL_X[0] + COLS[0].w / 2, y: writer.y - 11, size: 9, align: "center" });
    drawParagraph(writer.parts, item.description, COL_X[1] + COLS[1].w - 4, writer.y - 11, 9.5, 231);
    if (item.unitLabel.trim()) {
      drawParagraph(writer.parts, item.unitLabel, COL_X[3] + COLS[3].w / 2, writer.y - 11, 9.5, 37);
    }
    drawTextLine(writer.parts, item.quantityText, { x: COL_X[2] + COLS[2].w - 4, y: writer.y - 11, size: 9.5, align: "right" });
    drawTextLine(writer.parts, item.unitPriceText, { x: COL_X[4] + COLS[4].w - 4, y: writer.y - 11, size: 9.5, align: "right" });
    drawTextLine(writer.parts, formatMoney(item.lineTotalMinor), { x: COL_X[5] + COLS[5].w - 4, y: writer.y - 11, size: 9.5, align: "right" });
    writer.y -= rowHeight;
    writer.parts.push(colorOps(RULE, false), `1 w ${fmt(MARGIN)} ${fmt(writer.y)} m ${fmt(MARGIN + CONTENT_W)} ${fmt(writer.y)} l S`);
  });
  writer.tableHeaderPending = false;
}

function drawTotals(writer: PdfWriter, snapshot: QuotationPdfSnapshot): void {
  writer.y -= 12;
  writer.ensure(26);
  writer.y -= 18;
  writer.parts.push(colorOps(INK, false));
  drawTextLine(writer.parts, "الإجمالي الفرعي", { x: PAGE_W - MARGIN, y: writer.y, size: 10, align: "right" });
  drawTextLine(writer.parts, formatMoney(snapshot.subtotalMinor), { x: PAGE_W - MARGIN - 210, y: writer.y, size: 10.5, align: "right" });
  writer.parts.push(colorOps(MUTED, false));
  drawTextLine(writer.parts, `SUBTOTAL (${snapshot.currency})`, { x: MARGIN, y: writer.y, size: 7, align: "left" });
  writer.parts.push(colorOps(INK, false), `1.2 w ${fmt(PAGE_W - MARGIN - 240)} ${fmt(writer.y - 6)} m ${fmt(PAGE_W - MARGIN)} ${fmt(writer.y - 6)} l S`);
}

function drawNoteBlock(writer: PdfWriter, headingAr: string, headingEn: string, body: string): void {
  const text = body.trim();
  if (!text) return;
  const lines = wrapLines(text, 9, 470);
  writer.y -= 16;
  writer.ensure(24 + lines.length * 11);
  writer.parts.push(colorOps(MUTED, false));
  drawTextLine(writer.parts, headingAr, { x: PAGE_W - MARGIN, y: writer.y, size: SMALL_NOTE, align: "right" });
  drawTextLine(writer.parts, headingEn, { x: MARGIN, y: writer.y, size: 7, align: "left" });
  writer.parts.push(colorOps(INK, false));
  for (const line of lines) {
    writer.ensure(11);
    writer.y -= 11;
    drawTokens(writer.parts, line.tokens, PAGE_W - MARGIN - line.width, writer.y, 9, line.rtl);
  }
}

/* --------------------------------------------------------------- finalize -- */

function drawWatermark(page: string[]): void {
  page.push(
    "q",
    `0.866 -0.5 0.5 0.866 ${fmt(PAGE_W / 2 - 140)} ${fmt(PAGE_H / 2)} cm`,
    colorOps(WATERMARK_C, false),
  );
  drawTokens(page, tokenize("DRAFT"), 8, 0, WATERMARK_SIZE, false);
  drawTokens(page, tokenize("مسودة"), 8 + latinWidth("DRAFT", WATERMARK_SIZE) + 20, 0, WATERMARK_SIZE, true);
  page.push("Q");
}

function finalizeFooter(writer: PdfWriter, draft: boolean): void {
  const total = writer.pages.length;
  for (let i = 0; i < total; i += 1) {
    const page = writer.pages[i];
    page.push(
      colorOps(RULE, false),
      `1 w ${fmt(MARGIN)} 44 m ${fmt(PAGE_W - MARGIN)} 44 l S`,
      colorOps(MUTED, false),
    );
    drawTextLine(page, "ExportFlow · W2 quotations", { x: MARGIN, y: 33, size: 7, align: "left" });
    const label = `Page ${i + 1} of ${total}`;
    const labelWidth = latinWidth(label, 7);
    page.push(`BT /F1 7 Tf 1 0 0 1 ${fmt(PAGE_W - MARGIN - labelWidth)} 33 Tm (${pdfEscape(label)}) Tj ET`);
    drawTextLine(page, `صفحة ${i + 1} من ${total}`, { x: PAGE_W - MARGIN - labelWidth - 12, y: 33, size: 7, align: "right" });
    if (draft) drawWatermark(page);
  }
}

/* ------------------------------------------------------------- assembly --- */

function toBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

function assemble(pages: string[][]): Uint8Array {
  const parts: string[] = [];
  let pos = 0;
  const offsets: number[] = [];
  const push = (s: string): void => {
    parts.push(s);
    pos += s.length;
  };
  const obj = (n: number, body: string): void => {
    offsets[n] = pos;
    push(`${n} 0 obj\n${body}\nendobj\n`);
  };
  push("%PDF-1.4\n%\xE2\xE3\xCB\xD3\n");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  const first = 4;
  const kids = pages.map((_, i) => `${first + 2 * i} 0 R`).join(" ");
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  obj(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  pages.forEach((pageOps, i) => {
    const pageObj = first + 2 * i;
    const contentObj = pageObj + 1;
    const stream = pageOps.join("\n");
    obj(
      pageObj,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObj} 0 R >>`,
    );
    obj(contentObj, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  const size = 3 + 2 * pages.length + 1;
  const xrefPos = pos;
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let n = 1; n < size; n += 1) xref += `${String(offsets[n] ?? 0).padStart(10, "0")} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`);
  return toBytes(parts.join(""));
}

/* ---------------------------------------------------------------- public -- */

/**
 * Render the quotation PDF as a pure function of the issued snapshot.
 * `draft: true` adds the unmistakable DRAFT watermark on every page.
 */
/** Shared with the trade-document renderer. Does not change quotation output. */
export function paintTradeLine(out: string[], text: string, x: number, y: number, size: number, align: "left" | "right" | "center") {
  drawTextLine(out, text, { x, y, size, align });
}

export function tradeLineCount(text: string, size: number, maxWidth: number) {
  const chunks = text.split(/\r?\n/).filter((line) => line.length > 0);
  if (!chunks.length) return 1;
  return chunks.reduce((count, chunk) => count + Math.max(1, wrapLines(chunk, size, maxWidth).length), 0);
}

export function paintTradeBlock(out: string[], text: string, x: number, y: number, size: number, maxWidth: number, align: "left" | "right") {
  let cursor = y;
  const chunks = text.split(/\r?\n/);
  for (const chunk of chunks.length ? chunks : [""]) {
    const lines = wrapLines(chunk || " ", size, maxWidth);
    for (const line of lines.length ? lines : wrapLines(" ", size, maxWidth)) {
      const left = align === "right" ? x - line.width : x;
      drawTokens(out, line.tokens, left, cursor, size, line.rtl);
      cursor -= size + 2;
    }
  }
  return cursor;
}

export function paintTradeCenteredBlock(out: string[], text: string, centerX: number, y: number, size: number, maxWidth: number) {
  let cursor = y;
  const chunks = text.split(/\r?\n/);
  for (const chunk of chunks.length ? chunks : [""]) {
    const lines = wrapLines(chunk || " ", size, maxWidth);
    for (const line of lines.length ? lines : wrapLines(" ", size, maxWidth)) {
      drawTokens(out, line.tokens, centerX - line.width / 2, cursor, size, line.rtl);
      cursor -= size + 2;
    }
  }
  return cursor;
}

export function renderQuotationPdf(snapshot: QuotationPdfSnapshot, opts: { draft: boolean }): Uint8Array {
  const writer = new PdfWriter();
  writer.startPage();
  drawLetterhead(writer, snapshot);
  drawInfoBlock(writer, snapshot);
  drawBuyerBlock(writer, snapshot);
  drawItemsTable(writer, snapshot);
  drawTotals(writer, snapshot);
  drawNoteBlock(writer, "شروط الدفع", "PAYMENT TERMS", snapshot.paymentTerms);
  drawNoteBlock(writer, "ملاحظات", "NOTES", snapshot.notes);
  writer.finishPage();
  finalizeFooter(writer, opts.draft);
  return assemble(writer.pages);
}
