# Checkpoint 06.5.2 change and rollback log

No Git operations. Hashes are SHA-256 prefixes taken after the edits.

| File | After hash / size | Why | Rollback | Risk |
|---|---|---|---|---|
| `server/services/reminders.ts` | `b155f66a4b6080c7` / 36099 | Replace the serial per-case loop in `updateRule` for the 11 seeded families with one set load and batched writes. Skip cancel statements when the dedup key did not change. | Restore the file. Rule PATCH returns to about 220 s on 400 review cases. | Recompute is broader than "cases that already have an instance" and narrower than a full case graph. Same-offset histogram matched. |
| `server/http/app.ts` | `83cbfc13d19f430a` / 29002 | Health adds `fixture` only when `EXPORTFLOW_FIXTURE` is set. Canonical E2E does not set it. | Remove the spread. | None for production unless someone sets the variable. |
| `worker-configuration.d.ts` | `9d8d7484167a0c9f` / 994 | Declares the optional fixture variable. | Remove the field. | None. |
| `vite.reliability.config.ts` | `342a613ae2bbbfb5` / 966 | Diagnostic Vite ignores watches when `CI=1`, matching canonical E2E. Stops SQLite WAL reloads from looping the login page. | Remove the `watch` line. Arm B browser login becomes unstable again. Product Vite is unchanged. | Diagnostic only. |
| `scripts/reliability-arm-b.mjs` | `8f778a4edf5bbce2` / 4427 | Writes `EXPORTFLOW_FIXTURE=reliability-b` into the disposable vars file. | Remove that line. The session script will then refuse to start. | Does not read project `.dev.vars`. |
| `scripts/checkpoint-06-5-2-family-timing.mjs` | `84ee440293102456` / 2477 | Times every seeded rule PATCH on port 43176 only. | Delete. | Refuses any other base URL. |
| `scripts/checkpoint-06-5-2-instance-snapshot.mjs` | new | Read-only status histogram of the perf SQLite file. | Delete. | `readOnly: true`. |
| `scripts/checkpoint-06-5-2-arm-b-session.mjs` | `f2a2a44999844257` / 11136 | Fail-closed session, browser journey, long loop. | Delete. | Reads only the Arm B vars file after a realpath check. |
| `scripts/checkpoint-06-5-2-arm-b-probe.mjs` | new | Login-page probe that showed the reload loop. | Delete. | No secrets. |
| `playwright.config.ts` | `edd999ed3dfb58ee` unchanged | Not modified. | n/a | n/a |
| `package.json`, `pnpm-lock.yaml` | unchanged `4fc782e879daa811`, `2d0f2ff775f2a438` | No dependency change. | n/a | n/a |

## Abandoned attempts

| Attempt | Result | Kept? |
|---|---|---|
| Perf server without pinning `EXPORTFLOW_PORT` | Bound to 43174 because the shell had inherited that variable. Stopped before a measurement. | No |
| Per-row cancel inside the batch | Documents 4462 ms, review 5466 ms. Replaced by cancel-only-when-key-differs. | No |
| Arm B browser while Vite watched the SQLite WAL | Login form never stayed mounted. `page reload` of `*.sqlite-wal` was in the Vite log. | Fixed in the diagnostic config only |
| Playwright `chromium` download | Executable missing. Switched to `channel: "chrome"`, which is what `playwright.config.ts` already uses. | Harness only |
| First Arm B process loaded nothing from the project vars file | It did use the arm vars file, then the browser harness crashed after bootstrap. State was rebuilt rather than reused with a lost password. | Rebuilt |

No product HTTP retry. No auth bypass. No Tailwind change. CSS bundle hash `index-BipniZkD.css` stayed 30.68 kB. Client JS hash `index-Bc7FcXnZ.js` stayed 541.74 kB.
