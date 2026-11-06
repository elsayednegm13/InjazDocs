/** Privacy reduction only: browser wording is read locally and never retained. */
import { checkNoPII, routeLabelHasPII } from "./no-pii";
import { CALL_GROUP_DESTINATIONS } from "./callGroups";
export const CRASH_CODE_SERVICES = CALL_GROUP_DESTINATIONS.filter(
  token => token !== "same-origin" && token !== "third-party" && token !== "unnamed",
);
export const CRASH_MISTAKE_WIRE = ["read-from-nothing", "name-not-defined", "not-a-function", "request-failed", "data-unreadable", "stale-code-file", "storage-refused", "browser-blocked", "details-hidden", "not-recognised"] as const;
export const CRASH_NAMED_MISTAKES = ["name-not-defined", "not-a-function", "read-from-nothing"] as const;
export const CRASH_CODE_NAME_STATES = ["withheld", "not-printed"] as const;
export const CRASH_CODE_OWNERS = ["inline-page", "same-site", "store-platform", "named-service", "other-address", "no-address"] as const;
export const CRASH_INLINE_PAGE_FILE = "<page>";
export const CRASH_CODE_NAME_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}(?:\.[A-Za-z_$][A-Za-z0-9_$]{0,63}){0,4}$/;
export interface CrashCauseFields {
  mistake?: typeof CRASH_MISTAKE_WIRE[number];
  codeName?: string;
  codeNameState?: typeof CRASH_CODE_NAME_STATES[number];
  codeOwner?: typeof CRASH_CODE_OWNERS[number];
  codeService?: typeof CRASH_CODE_SERVICES[number];
}
/** A name leaves the device only when the browser copied it out of the
 *  site's code as SOURCE TEXT (an identifier or a dotted path) and the error
 *  is the engine's own class for that wording. Withheld, never sent: a
 *  property KEY the engine printed after evaluating it (Chrome's "(reading
 *  'k')", Firefox's 'can't access property "k"'), which can be a value from
 *  the page (`data[userName]`), and any name in an error the site's own code
 *  built (a plain Error, a thrown string) that only copies engine wording.
 *  Shape screens cannot tell a person's name from a code name; provenance can. */
function named(mistake: typeof CRASH_NAMED_MISTAKES[number], engineClass: boolean, name?: string, sourceText = true): CrashCauseFields {
  if (name === undefined) return { mistake, codeNameState: "not-printed" };
  if (!engineClass || !sourceText) return { mistake, codeNameState: "withheld" };
  return name.length <= 80 && CRASH_CODE_NAME_PATTERN.test(name) && !routeLabelHasPII(name) && !checkNoPII(name)
    ? { mistake, codeName: name }
    : { mistake, codeNameState: "withheld" };
}
export function crashCause(name: string, message: string): CrashCauseFields {
  const m = message.slice(0, 500);
  if (name === "CrossOriginScriptError" || m === "Script error.") return { mistake: "details-hidden" };
  if (/^(?:Css)?ChunkLoadError$/.test(name) || /Loading (?:CSS )?chunk .*failed|(?:Failed to fetch|error loading) dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(m)) return { mistake: "stale-code-file" };
  if (/QuotaExceededError|NS_ERROR_DOM_QUOTA_REACHED/.test(name) || /exceeded the quota|quota has been exceeded/i.test(m) || /(?:localStorage|sessionStorage|indexedDB)/i.test(m) && /SecurityError|Access is denied/i.test(name + m)) return { mistake: "storage-refused" };
  if (name === "NotAllowedError" || /play\(\) failed because the user didn't interact|request is not allowed by the user agent|Document is not focused|Blocked a frame with origin/i.test(m)) return { mistake: "browser-blocked" };
  if (/AxiosError|FetchError|HTTPError/.test(name) || /^(?:Failed to fetch|NetworkError when attempting to fetch resource\.?|Load failed|The network connection was lost\.?|Network request failed|Network Error|Request failed with status code \d+)$/.test(m)) return { mistake: "request-failed" };
  if (/Unexpected token .*in JSON|is not valid JSON|Unexpected end of JSON input|JSON\.parse:|JSON Parse error:/i.test(m)) return { mistake: "data-unreadable" };
  const ref = name === "ReferenceError", type = name === "TypeError";
  let hit = m.match(/^(.*?) is not defined\b/) ?? m.match(/^Can't find variable:\s*(.*)$/i) ?? m.match(/^(?:Cannot access|can't access lexical declaration) ['"]([^'"]+)['"] before initialization/i);
  if (hit) return named("name-not-defined", ref, hit[1]);
  if (ref) return named("name-not-defined", true);
  if (/^undefined is not a function \(near /i.test(m)) return named("not-a-function", type);
  hit = m.match(/^(.*?) is not a (?:function|constructor)\b/);
  if (hit) return named("not-a-function", type, hit[1]?.replace(/\([^)]*\)$/, ""));
  // Chrome prints only the property KEY it evaluated: it can be a value.
  hit = m.match(/^Cannot (?:read|set) propert(?:ies|y) of (?:undefined|null)(?: \((?:reading|setting) ['"]([^'"]*)['"]\))?/i) ?? m.match(/^Cannot (?:read|set) property ['"]([^'"]*)['"] of (?:undefined|null)/i);
  if (hit) return named("read-from-nothing", type, hit[1], false);
  // Firefox: the KEY is evaluated (never sent); the expression that was
  // nothing is copied from the code.
  hit = m.match(/^can't access property ['"][^'"]*['"], (.+?) is (?:undefined|null)$/i);
  if (hit) return named("read-from-nothing", type, hit[1]);
  hit = m.match(/^(.*?) (?:is undefined|is null|has no properties)$/);
  if (hit) return named("read-from-nothing", type, hit[1]);
  hit = m.match(/^(?:undefined|null) is not an object(?: \(evaluating ['"](.*?)['"]\))?/);
  if (hit) return named("read-from-nothing", type, hit[1]);
  return { mistake: "not-recognised" };
}
