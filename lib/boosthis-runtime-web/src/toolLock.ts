/** Node-side tools have no browser verdict. Never consult the browser's
 * activation lock here: hosted/server callers have no browser activation.
 * An unreachable server leaves the built-in book available until an explicit
 * refusal has been learned in THIS process. Nothing is stored on disk. */
import { readAnswerJson } from "./answerRead";
import { kitTimeout } from "./zoneSafe";

export const RULE_LOCK_REFUSAL = "Boosthis is locked for this project, so this kit answers no rule questions until the project is active again. Renew at boosthis.com.";
let locked = false;
let generation = 0;
let nextAsk = 0;
let retry: (() => Promise<Response>) | null = null;
let checking: Promise<void> | null = null;
const holders = new Set<() => void>();
export function registerToolHolder(drop: () => void): void { holders.add(drop); }
export function toolGeneration(): number { return generation; }
export function toolLocked(): boolean { return locked; }

export async function learnToolRefusal(
  res: Response,
  askAgain?: () => Promise<Response>,
  installRead = false,
): Promise<void> {
  let refused = res.status === 402 || (installRead && res.status === 403);
  if (!refused && res.status === 403) {
    try {
      const body = await readAnswerJson(res.clone()) as { error?: string; reason?: string };
      refused = [body.error, body.reason].some(word =>
        word === "invite_key_revoked" || word === "plan_required" || word === "account_closure_pending");
    } catch { /* unreadable is not a known refusal */ }
  }
  if (!refused) return;
  locked = true;
  generation++;
  nextAsk = Date.now() + 6 * 60 * 60 * 1000;
  retry = askAgain ?? null;
  for (const drop of holders) { try { drop(); } catch { /* isolate holders */ } }
}

export async function toolRefusal(): Promise<string | null> {
  if (!locked) return null;
  if (Date.now() >= nextAsk && retry) {
    if (!checking) {
      nextAsk = Date.now() + 6 * 60 * 60 * 1000;
      const ask = retry;
      checking = (async () => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const res = await Promise.race([
            ask(),
            new Promise<null>(resolve => { timer = kitTimeout(() => resolve(null), 5000); }),
          ]);
          if (!res) return;
          if (res.ok) { locked = false; generation++; }
          else await learnToolRefusal(res, ask, true);
        } catch { /* a known lock survives an outage */ }
        finally { if (timer !== undefined) clearTimeout(timer); }
      })().finally(() => { checking = null; });
    }
    await checking;
  }
  return locked ? RULE_LOCK_REFUSAL : null;
}
