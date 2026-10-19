# Checkpoint 06.5.2 open issues and owner decisions

No approval is implied by this list.

| Priority | Issue | Evidence | Decision needed |
|---|---|---|---|
| P0 | Canonical `ECONNRESET` / Vite `fetch failed` still drops requests before Hono | Playwright run 1: 32 passed, exit 0, 5 trace lines and 6 Vite lines. Stack: undici `processResponse` → `dispatchFetch` → plugin line 56327. No handler enter. | Owner must approve any plugin/Miniflare/workerd upgrade or a permanent proxy topology. This checkpoint did not change those versions. |
| P1 | Arm B long run had 0 resets but was not the Playwright mix | 1950 authenticated calls, 605485 ms, 0 resets, empty case database | Do not treat Arm B as proof the product hop is fixed. A full Playwright run on Arm B was not executed. |
| P1 | Cron and case-event recompute are still serial | `processDueReminders` and approval/booking/bank callers still use `recomputeRemindersForCase`. Not timed at 500 cases this run | Approve a later batch of those paths only if a 500-case cron measurement shows a hang. |
| P2 | `CUSTOM_FOLLOWUP` is named and not implemented | Enum only | Do not invent the policy. |
| P2 | Families with zero dated rows were not proven at 500 writes | Loading, cutoff, container follow-up, goods delivery | A fixture with those dates is required before calling those families measured at scale. |
| P2 | 10-case and 100-case reminder timings | Not reseeded | Optional. The hang was at 500. |
| P3 | Document-rule PATCH is slower than the 06.5.1 453 ms figure | Warm server 983–1391 ms because the shared path also refreshes `next_action` | Accept about 1 s, or split `next_action` if a tighter budget is required. |
| P3 | Tailwind Plus / UX 06.6 | License not available. No visual approval | Do not start 06.6 from this report. |

Cloud staging was not run. Developer database and project secrets were not modified.
