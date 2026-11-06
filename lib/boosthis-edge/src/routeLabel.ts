/** Route labels for an isolate request — the same redaction rules the Node kit
 * applies to an unmatched path.
 *
 * An isolate has no framework route table to ask, so EVERY label goes through
 * the fallback rules: the strict keyword allowlist plus the id/PII shapes
 * below. The shared part-name contract is `lib/part-name-vocabulary.json`, so
 * a label that is safe on Node is byte-for-byte the same label here.
 */

// BOOSTHIS_PART_NAME_V1 — shared with lib/part-name-vocabulary.json.
export const MAX_PART_NAME = 100;

// BOOSTHIS_PART_NAME_LETTERS_V1 — shared with lib/part-name-vocabulary.json
// ("letters"). The same step as the server's `readablePartName` and the
// browser kit's `readableLetters`. Every label here is the request's
// `URL.pathname`, which the URL parser leaves escaped, so an Arabic address
// arrives as `%D9%82…` — six characters a letter. Measured that way, a
// two-word Arabic address passed the bound and was refused in the isolate,
// where the server can no longer undo it.

/** A run of escaped bytes, decoded together as UTF-8. */
const ESCAPE_RUN = /(?:%[0-9A-Fa-f]{2})+/g;

/**
 * A letter, a combining mark or a number. Built at first use and inside a
 * try: an engine without Unicode property classes keeps every escape as it
 * arrived (the old behaviour) rather than failing to load the kit.
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
  const b0 = bytes[i]!;
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
    const b = bytes[i + k]!;
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
    const seq = bytes[i]! >= 0x80 ? utf8At(bytes, i) : null;
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
 * arrived — an escaped space, slash or symbol, an invisible or
 * direction-changing character, and any byte that is not valid UTF-8 stay
 * escaped, in the same hex case. No normalisation. A string with no escaped
 * letters comes back unchanged, so every Latin address is named exactly as it
 * was before this step existed.
 */
export function readableLetters(text: string): string {
  if (typeof text !== "string" || text.indexOf("%") < 0) return text;
  return text.replace(ESCAPE_RUN, decodeRun);
}

/** Arabic-Indic and Extended Arabic-Indic digits written as 0–9, for the
 *  identifier tests ONLY — the name keeps the digits it was written in. */
export function latinDigits(seg: string): string {
  return seg.replace(/[\u0660-\u0669\u06f0-\u06f9]/g, (d) => {
    const code = d.charCodeAt(0);
    return String(code - (code >= 0x06f0 ? 0x06f0 : 0x0660));
  });
}

/** Escaped letters take at most nine characters per character they become,
 *  so a path longer than this can never fit the bound: refused before any
 *  work is spent on it. */
const MAX_ESCAPED_INPUT = MAX_PART_NAME * 9;

const NUMERIC_SEGMENT = /^\d+$/;
const UUID_SEGMENT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX24 = /^[0-9a-f]{24}$/i;
// PII-shaped segments that must NEVER be recorded as a route label.
// Boosthis's privacy contract says route labels are non-PII; without this
// redaction a path like /users/alice@example.com would surface verbatim
// in /recent and the MCP context.
const EMAIL_LIKE = /@/;
const HANDLE_LIKE = /^[~@][A-Za-z0-9._-]+$/;
const LONG_TOKEN = /^[A-Za-z0-9_-]{24,}$/;
// Slug-like segments: hyphen- or underscore-separated words are almost always
// user- or org-generated identifiers (e.g. "john-smith", "acme-co",
// "my_project") rather than static route keywords.
const SLUG_SEGMENT = /[-_]/;
// Mixed-case segments (PascalCase / camelCase) indicate a developer-chosen
// identifier rather than a lowercase route keyword (e.g. "JaneDoe",
// "myUsername").
const MIXED_CASE_SEGMENT = /^(?=.*[A-Z])(?=.*[a-z])[A-Za-z0-9]+$/;
// Alphanumeric segments that mix letters and digits are typically user-generated
// IDs (e.g. "user123", "abc4def"). Pure-digit segments caught by NUMERIC_SEGMENT.
const ALPHANUM_ID_SEGMENT = /^(?=.*[0-9])(?=.*[A-Za-z])[A-Za-z0-9]+$/;
// Pure lowercase alphabetic (no digits, hyphens, etc.).  This pattern on its
// own covers both safe route keywords ("users", "billing") and opaque short
// usernames ("alice", "bob"). Without the Express route template we cannot
// tell which is which, so we gate on a strict allowlist and redact everything
// else. The allowlist is intentionally conservative: only vocabulary that
// legitimately appears as a *static* URL segment in a REST or HTTP API.
const PURE_LOWER_ALPHA = /^[a-z]+$/;

/**
 * Known-safe pure-lowercase route-keyword segments (3 or more characters).
 * Any pure-lowercase-alpha segment of 3+ chars NOT in this set is treated as
 * a potential user/org identifier and replaced with :id. Segments of 1-2 chars
 * (e.g. "u", "me") are left as-is — they are almost always route namespace
 * abbreviations, not usernames, and the information loss from redacting them
 * outweighs the risk.
 *
 * This is the correct privacy posture: Boosthis's contract requires route
 * labels to be non-PII, and there is no mechanical way to distinguish "alice"
 * (username) from "users" (keyword) without the Express route template.
 */
const SAFE_ROUTE_KEYWORDS = new Set([
  // versioning / top-level
  "api", "app", "web", "www",
  "v1", "v2", "v3", "v4", "v5",
  // health / observability
  "health", "healthz", "status", "ping", "ready", "live", "metrics",
  "stats", "analytics", "logs", "log", "errors", "debug", "trace", "info",
  // auth
  "auth", "oauth", "login", "logout", "signup", "signin", "register",
  "callback", "redirect", "verify", "confirm", "reset", "refresh",
  // common resource collections
  "users", "user", "accounts", "account", "profile", "profiles",
  "orgs", "org", "organizations", "organization",
  "teams", "team", "members", "member",
  "groups", "group", "roles", "role",
  "projects", "project", "workspaces", "workspace",
  "admin", "dashboard", "self",
  "customers", "customer", "clients", "client",
  "patients", "patient",
  "employees", "employee",
  "contacts", "contact",
  "records", "record",
  // commerce / billing
  "billing", "subscriptions", "subscription",
  "invoices", "invoice", "payments", "payment", "charges", "charge",
  "orders", "order", "products", "product",
  "items", "item", "catalog", "inventory",
  "coupons", "coupon", "discounts", "discount",
  // content
  "files", "file", "uploads", "upload", "downloads", "download",
  "attachments", "attachment", "images", "image", "media", "assets",
  "static", "public",
  "messages", "message", "conversations", "conversation", "chat",
  "notifications", "notification",
  "comments", "comment", "posts", "post",
  "pages", "page", "tags", "tag", "categories", "category",
  "labels", "label",
  // actions / generic segments
  "search", "filter", "sort", "index", "list",
  "settings", "config", "preferences",
  "create", "new", "edit", "update", "delete", "view", "show",
  "home", "about", "help", "support", "contact", "docs",
  "documentation", "reports", "report",
  // jobs / queues
  "jobs", "job", "tasks", "task", "queues", "queue", "events", "event",
  "webhooks", "webhook", "integrations", "integration",
  "services", "service", "rules", "rule",
  "policies", "policy", "permissions", "permission",
  "sessions", "session",
  // Boosthis-specific route segments
  "candidates", "resolutions", "installs", "samples",
  "consent", "forget", "mcp", "context", "budgets", "recent", "summary",
  "community", "fix", "fixes", "keys", "privacy", "terms",
]);

/** Convert /users/42/orders/acme-co → /users/:id/orders/:id, and redact
 * PII-shaped segments (emails, @handles, long tokens, hyphen/underscore slugs,
 * mixed-case identifiers, alphanumeric IDs, and any pure-lowercase word of 3+
 * characters not in the known-safe keyword allowlist).
 *
 * The allowlist fast-path fires first so version strings ("v1", "v2") and
 * other explicitly-safe keywords are always preserved, even if their shape
 * (e.g. mixing digits and letters) would otherwise match one of the redaction
 * patterns below.
 *
 * The allowlist approach for pure-lowercase segments is intentionally
 * conservative: Boosthis's privacy contract requires route labels to be
 * non-PII, and there is no mechanical way to distinguish a short username
 * ("alice") from a route keyword ("users") without the Express route template.
 * When the matched-route branch is used the template already supplies correct
 * `:param` placeholders; the fallback branch applies these rules to the raw
 * request path. Segments of 1-2 characters are left as-is (they are almost
 * always route namespace abbreviations, not usernames). */
export function normalizePath(path: string): string | null {
  if (typeof path !== "string" || path.length > MAX_ESCAPED_INPUT) return null;
  // Letters before the rule (BOOSTHIS_PART_NAME_LETTERS_V1): the bound
  // measures what a person reads. Only the spelling changes — a word in
  // another script is kept exactly as its escaped form was kept — except that
  // a number written in Arabic-Indic digits is now read as the number it is.
  const readable = readableLetters(path);
  if (readable.length > MAX_PART_NAME) return null;
  const normalized = readable
    .split("/")
    .map((seg) => {
      if (!seg) return seg;
      // Allowlist fast-path: known-safe route keywords are always preserved
      // regardless of their shape (e.g. "v1" contains a digit but must not be
      // redacted). This check fires before any pattern-based redaction.
      if (SAFE_ROUTE_KEYWORDS.has(seg)) return seg;
      // The identifier tests read Arabic-Indic digits as 0–9; a segment that
      // survives keeps the digits it was written in.
      const shape = latinDigits(seg);
      if (NUMERIC_SEGMENT.test(shape)) return ":id";
      if (UUID_SEGMENT.test(shape)) return ":id";
      if (HEX24.test(shape)) return ":id";
      if (EMAIL_LIKE.test(shape)) return ":id";
      if (HANDLE_LIKE.test(shape)) return ":id";
      if (LONG_TOKEN.test(shape)) return ":id";
      if (SLUG_SEGMENT.test(shape)) return ":id";
      if (MIXED_CASE_SEGMENT.test(shape)) return ":id";
      if (ALPHANUM_ID_SEGMENT.test(shape)) return ":id";
      // Pure lowercase alpha, 3+ chars, not in allowlist → potential identifier.
      // Short segments (1-2 chars, e.g. "u", "s") are preserved: they are
      // overwhelmingly route namespace abbreviations, not usernames.
      if (PURE_LOWER_ALPHA.test(shape) && shape.length >= 3) return ":id";
      return seg;
    })
    .join("/");
  return normalized.length <= MAX_PART_NAME ? normalized : null;
}
