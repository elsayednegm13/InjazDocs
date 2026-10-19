# ExportFlow — Checkpoint 06.7.1
## Premium Operations Workspace: Reference-Driven UI Reconstruction Without Business-Logic or Roadmap Changes

**EXECUTION AUTHORIZATION:** The owner explicitly requested a strong implementation prompt to translate the two generated Premium Operations Workspace concept images into the EXISTING ExportFlow application. This authorizes **local, bounded front-end implementation of this checkpoint only**. It does NOT authorize a product roadmap change, backend rewrite, cloud deployment, production release, database migration, Git operation, or automatic continuation to 06.8.

**VERIFIED PROJECT ROOT FROM HISTORICAL REPORTS:** `I:\WORK\InjazDocs`. Check that this path actually contains the existing app before doing anything. Do not create a replacement project.

**TEAM ROLE:** Act simultaneously as Principal Product Engineer, Staff Frontend Engineer, Staff Backend Contract/Security Reviewer, Design Systems Lead, Senior Arabic RTL UX Designer, Accessibility Specialist, Software Performance Engineer, and Evidence-Based QA Lead.

**PROMPT LANGUAGE:** English. **FINAL REPORT LANGUAGE:** Comprehensive Arabic, with exact technical names preserved.

**HIGH-LEVEL MANDATE:** Reconstruct the *visual and interaction language* of the supplied target images in the existing React application. Preserve the application's real information architecture, schemas, API contracts, employee workflows, permissions, data isolation, security, business decisions, operational semantics, deployment model and approved development plan. The new visual direction supersedes the previous provisional styling direction, **not** the product requirements or engineering architecture.

**CONTRACT:** Design is replaceable. Business truth is not.

---

# 0. FIRST: find, verify, and cite the supplied design references

The owner is supplying an asset bundle alongside this prompt. **Do not proceed with a visual reconstruction without inspecting both actual target PNG files.** Paths relative to the extracted bundle's root:

1. `REFERENCES/TARGET_01_Premium_Dashboard_AR.png` — **PRIMARY DESIGN REFERENCE A**: Premium Arabic dashboard composition, navy right sidebar, contemporary top bar, restrained port hero, KPI strip, Today Actions, grouped alerts, upcoming deadlines, distinct documentation and cargo sections, compact activity feed.
2. `REFERENCES/TARGET_02_Premium_Export_Operations_AR.png` — **PRIMARY DESIGN REFERENCE B**: Premium export cases workspace, same shell/visual language, summary row, searchable filter toolbar, compact desktop data table, selected-case contextual details, case tabs and clear next action.

Both target renders are **1672 × 941 PNG, AI-generated visual concepts**. Treat them as a **visual specification only**, not proof of application capabilities, legitimate domain values, API fields, dates, permissions, ratios, existing routes or business formulas. They may contain misspelled Arabic or fictitious metadata. Correct copy with the actual translations and data definitions.

Included current-app, **historical checkpoint-06.7 baseline** references:

- `BASELINE_CHECKPOINT_06_7/after/dashboard-admin-ar-1366.png`
- `BASELINE_CHECKPOINT_06_7/after/cases-admin-ar-1366.png`
- `BASELINE_CHECKPOINT_06_7/after/dashboard-admin-ar-390.png`
- `BASELINE_CHECKPOINT_06_7/after/dashboard-admin-ar-768.png`
- `BASELINE_CHECKPOINT_06_7/after/cases-admin-ar-390.png`
- `BASELINE_CHECKPOINT_06_7/after/cases-admin-en-768.png`
- ALL other 18 baseline images under `BASELINE_CHECKPOINT_06_7/after/` (24 combinations total).

Before editing code, copy the provided target and baseline images into a **documented local project documentation-only directory**, e.g. `docs/design-references/exportflow-premium-workspace-0671/` with filenames and SHA-256 values preserved, if and only if the project directory is verified and doing so cannot overwrite existing files. They must NOT enter public `dist` accidentally. Maintain an asset manifest mapping target references to page/region/component. If supplied PNG files cannot be accessed, report **BLOCKED: MISSING_REFERENCE_ASSETS**. Do not pretend screenshots were opened.

**Reference precedence:** (1) owner's frozen product decisions and backend contracts; (2) current code and verified data semantics; (3) target PNGs for layout/visual rhythm; (4) baseline screenshots for actual existing navigation/control coverage; (5) design best practices for details that the PNGs cannot specify. If a reference conflicts with a frozen rule, follow the rule and document the visual adaptation.

---

# 1. The project mission — required understanding before touching UI

ExportFlow is a bilingual **Arabic/English operations platform for export companies**. Its purpose is to manage the real lifecycle of export documentation and transport, replacing scattered spreadsheets and manual status chasing. A member of an export team must know: Which customer's export operation is this? Which documents are incomplete, under review, approved, handed to a bank or sent directly? Where is the paper courier consignment? What is the booking/vessel/container status? Which deadlines and next actions are actually due? Has the shipment merely arrived at the port, or has the customer received it? What may this employee see or do?

It is **NOT** a generic CRM, transport marketplace, invoicing template, advertising analytics dashboard, automated DHL/carrier tracking tool, customs clearance brokerage, or an invented financial system. Its primary information unit is the existing export **CASE** / operation, often referenced as `EF-...`, with related objects and independent timelines.

The product's original requirements, architectural choices and previously agreed development roadmap remain binding. UI redesign is not a license to add new modules, rewrite data models, rename APIs, add arbitrary workflow steps or alter existing roles. Confirm actual implementation from code: historic reports are clues, not source-of-truth proof.

## 1.1 Actual actors and authorization

- Authorized Admin creates/manages company users, roles, permissions and allowed settings; no public employee signup.
- Export officer/employee works on only their authorized cases and action set; case-specific assignment/scope still enforced by API.
- Roles are dynamic/configurable with granular permissions and per-user overrides. No hardcoded 'admin always sees X' without consulting the real authorization service.
- The backend must reject unauthorized access regardless of menu/sidebar visibility. Never send global summary totals to restricted officers and filter solely in React.
- Last-active-admin protections, session security, CSRF, error semantics, 401/403 distinctions, and current cookie session flow must remain intact.
- External customers see only restricted **public tracking** behind revocable/expiring links; they do not gain an internal account or access to invoice amounts/private PDFs.

## 1.2 Core business objects and constraints (FROZEN)

**Customers:** names, contacts, multiple addresses, tax/bank details where currently supported; snapshots of customer information at case creation must remain historical and independent from later profile changes. Never expose sensitive bank/customer details unnecessarily in global overview or screenshots.

**Cases:** each export operation tracks lifecycle, assignment, key next action and dates. A case is not itself an invoice, courier consignment, booking, container or document. Case completion must follow existing server criteria; never determine completion by frontend percentage alone.

**Invoices:** commercial invoice identifier and date; FOB/CFR terms, port(s), destination, payment terms, goods value, any invoiced freight, gross/net weights, explicit invoiced total, currency, relevant details. **The invoice total is explicitly entered business data**. Do not silently calculate it from product value or freight expense or redefine FOB/CFR. Destination-port arrival does not imply delivery.

**Completed-case Invoice Rule C (OWNER APPROVED):** when the parent case is `COMPLETED`, ordinary invoice and custom-field mutation is locked. Exceptional invoice correction requires exact backend permission `invoices.correct_completed`, a mandatory reason of **3–500 characters**, optimistic version safety, immutable before/after revisions and audit. Show lock/correction/history truthfully according to real data/permissions; do not add an edit control for unauthorized users or hide the audit trail. Migration `0004_invoice_revisions.sql` exists historically; **do not run a developer DB migration**.

**Documents:** case-specific dynamic required/optional checklist and immutable or versioned PDF attachments; missing/under review/approved semantics are real states. Physical original scans and actual bank handover are distinct events. Do not fake 'complete' for a file merely because it was uploaded.

**Document route:** `BANK` versus `DIRECT`. BANK follows bank delivery/review and physical original paperwork where applicable; DIRECT sends to customer directly and must NOT show bank handover as a mandatory gate. Preserve route-specific status events and associated courier details.

**Courier/DHL:** the courier/document delivery track is independent from vessel/cargo/container track. DHL/carrier tracking is **manual**, not a realtime external API integration. Never label courier dispatch as cargo delivered.

**Bookings & shipment:** Booking Confirmation PDF, booking reference and optional UCR, vessel/voyage, ports, loading/cutoff/ETD/ETA and actual timestamps where supported. Planned container slots may exist without official ISO container number; do not fabricate one or assume all bookings have five actual containers. Each real container is tracked independently. Vessel departure, arrival at destination port, customs and final delivery must not be conflated; **port arrival ≠ final customer delivery**.

**Reminders:** configurable rules based on case events, deadlines, status conditions and recipient permissions; deduplication, one-time/repeating cycles, caps, snooze, automatic resolution on condition change, ETA-cycle cancellation/regeneration, delivery while nobody is logged in. Show only existing due/reminder states. **`CUSTOM_FOLLOWUP` is not an approved implemented business workflow**; do not invent UI for it. Prior cron/performance and Cairo timezone questions remain unresolved and not authorized for business-logic changes.

**Public tracking:** only authorized, limited nonfinancial fields; revocable link; no private PDF or invoice amounts. Do not expand public scope to match a glossy mockup.

**Custom fields:** dynamic fields are attached to customers/cases/invoices/bookings/containers as supported; no design refactor may break validation, conditional visibility, edit forms, or data storage.

## 1.3 Important domain vocabulary for UI

Use precise distinction among **case status, document state, courier state, booking/ship state, container state, reminder priority, due time and next action**. These are different dimensions, not interchangeable percentages or badge colors. Do not invent business KPI meanings. Preserve English and Arabic terminology from existing localization sources unless there is a justified, mapped copy fix.

---

# 2. Existing platform — preserve, do not replace

Historic verified stack: React 19, Vite 7, TypeScript, Tailwind CSS v4 with `@theme`, bilingual locale + RTL/LTR, existing Radix/Lucide where installed; Cloudflare Vite/Workers plugin, Hono API `/api/v1`, Better Auth HttpOnly cookies, Cloudflare D1 relational state, private R2 documents, Cron reminders, local Miniflare/workerd. **Verify actual versions from package files; do not install based on assumed versions.**

Preserve:

1. Existing React SPA routes, deep linking, browser history, login/logout/session renewal and cookies.
2. API payload shapes, API errors, auth middleware, permissions, tenant/case scopes, data filtering, query/sort/pagination semantics.
3. Server-side customer snapshots and invoice/case correction consistency.
4. Documents, booking, containers, public tracking, R2/private file access, dynamic form validation.
5. The existing local Vite transport mitigation (320 ms serialization/connection close) as local-only; **do not remove, extend to prod or change it during UI work**.
6. Known risk register: reminder Cron waste after drain, real Worker concurrency, Cairo-relative calendar offset, 2000 D1 statement batch boundary, unspecified CUSTOM_FOLLOWUP, historical developer database metadata drift.
7. Owner's phase-review + single exhaustive Arabic report + explicit STOP process. **No automatic 06.8 or later stage.**

No backend or schema/API change is authorized in this checkpoint. If a design concept needs a nonexistent aggregate, document that limitation and show the nearest truthful existing view. **Never add fake frontend numbers or backend endpoints to make a mockup look complete.**

---

# 3. HARD SECURITY / ISOLATION GATES (BEFORE ANY COMMAND)

**Forbidden without separate owner approval:**

- Cloudflare deploy, login, provisioning, changing D1/R2, remote migrations, domain/DNS edits, staging, prod, paid assets, or remote resource inspection unrelated to this local UI task.
- Git init/add/commit/checkout/reset/push/tag/branch, deleting user code, major package upgrades or framework replacement.
- Any direct or indirect access to the developer's `.wrangler/state`, including opening its SQLite in read-only mode, WAL/SHM side effects, probes or old tests. The prior `isolated database does not contain the developer admin` test **touched WAL/SHM with a SELECT**; detect and refactor the test to isolated fixtures or safely skip it with a BLOCKED gate before running the suite. Never open that DB 'just to check'.
- Modifying actual `.dev.vars` or reading/printing stored secrets. Only synthesized dedicated isolated `.dev.vars.e2e` or checkpoint-scoped fixture credentials, verified not to contain or expose developer secrets. Check `dist` and screenshots for leaks.
- Replacing auth with localStorage, bypassing CSRF/cookies, disabling guards to pass E2E, expanding role permissions, or creating permissive demo endpoints.
- Deleting or rewriting developer DB even for cleanup. Work exclusively in new disposable `.wrangler-0671-*` stores with explicit isolation.
- Altering business rule semantics in reminders, invoices, case completion, shipment status or banking just to fit a label, chart, or button.
- Changing the already-approved system roadmap or adding new feature scope (customs portal, live tracking integrations, global map, new AI suggestions, reporting engine).

**Immediate fail-safe:** If any build/test process still resolves to developer `.wrangler/state` or another unowned data store, do not execute it. Fix only the test harness isolation, prove it, then continue. If unable, mark BLOCKED and STOP unsafe tests. Record before/after nonsecret file *metadata only* without opening developer database files or modifying them.

For this checkpoint, DO NOT write tests that do `SELECT` against developer SQLite to prove isolation. Block path access at the harness/configuration level and test that guard using synthetic paths.

---

# 4. Source read and reference-to-code mapping MUST PRECEDE changes

Create `docs/CHECKPOINT_06_7_1_SOURCE_AND_CONTRACT_LEDGER.md` with exact current:

1. Root proof; source version, package manager, lockfile, build/test commands, project instructions.
2. Route inventory and component dependency graph for existing `shell`, navigation, Dashboard, Cases list, Case detail; permission resolver; translations; Tailwind `src/index.css`; icons; responsive controls.
3. API endpoints used by Dashboard and list, field-level real data-source mapping and authorized scope; search parameters, pagination, sorting.
4. Existing DTO fields for invoices, documents, courier, booking/container, reminder and case next_action as visible on the two target surfaces; classify available/unavailable.
5. Historical 06.7 screenshot baselines and how to create a **new same-seed immediate before baseline** from current source.
6. Isolated Playwright fixture files / ports / worker bindings; identify any test that accesses default `.wrangler/state` directly or through a script.
7. CSS/font licenses/availability, `dir` and locale mechanisms, RTL numeric rendering, keyboard/focus behavior.
8. Current unsolved risks and business contract test coverage; previous `34/34` E2E and `31/31` unit are **PRIOR REPORTED BASELINES**, not automatic present results.

Next create `docs/CHECKPOINT_06_7_1_VISUAL_REFERENCE_MAPPING.md` including a **region-by-region table**:

`Reference file | region | visible design goal | existing route/component | actual source field | current behavior | safe proposed change | responsive mapping | security considerations | screenshot/functional test`.

Use two complete maps:

**TARGET_01 Dashboard regions:** right sidebar, application top bar, search, heading/hero, actionable KPI strip, Today's Actions, alert clusters, deadlines, *separate* documents and cargo indicators, activity list, empty/loading/error/permission states.

**TARGET_02 Cases regions:** right sidebar, section title, metrics summary, query/filters/create control, primary desktop table, row state/route/next action, selection, contextual case preview, tabbed/section content, next-action panel, mobile card/list/drawer behavior.

For every concept region, choose and document one of `IMPLEMENTABLE_FROM_EXISTING_API`, `ADAPT_TO_EXISTING_SEMANTICS`, `VISUAL_REFERENCE_ONLY`, `BLOCKED_BY_MISSING_REAL_SOURCE`. Do not fabricate a missing region.

---

# 5. Design language to IMPLEMENT from the two target PNGs

## 5.1 Overall look: Premium Operations Workspace

Recreate the premium modern enterprise feel visible in both PNGs, without turning the application into a static picture:

- Light natural paper canvas (approx `#F7F9FC`) with large white/elevated surfaces, clear ink/navy content (approx `#182839`), restrained teal for primary actions (approx `#0D9488`) and distinct warning/error/info status semantics. Exact token choices based on contrast inspection, not arbitrary copied hex from an AI rendering.
- Deep navy (`#10243A`-like) **right-side navigation in Arabic**, compact clear selected state, user account at top, role-aware links in existing actual navigation order.
- Professional visual grid, 8px-inspired spacing rhythm, quiet hairline borders, consistent 10–16px radius family, restrained elevation, clean compact enterprise tables.
- Typography strong but not overlarge; distinguish labels, numbers, timestamps, descriptions and actionable controls. Do not shrink dense operational data to unreadable sizes to mimic a 1672px picture.
- Modern semantic icon style: **one consistent already installed library; prefer `lucide-react` if present**, otherwise report compatibility; no second icon family by default. Minimal icons for nav, primary actions, status and headers, not every cell; accessible labels for icon-only buttons.
- A refined title area. The concept has a ship photo/banner, but it is **optional** if a legally usable optimized standalone image asset is unavailable. Never embed/crop the entire reference screenshot as a functional screen. Do not create a massive hero that pushes urgent tasks below the fold. If an appropriate self-owned/licensed asset is present, use it subtly with text contrast and image optimization; otherwise reproduce the spatial composition with CSS.
- Color not sole status signal; explicit words and readable badges. Avoid fake progress circles, loading percentage, growth arrows, sample numbers, flags, countdowns or trend indicators unless the real backend has legitimate values.
- Do NOT add visually invented pages/links featured in the generated sidebar if they do not exist in the app.

## 5.2 Sidebar/topbar

At desktop (target 1366 or wider), a stable right-side sidebar plus content viewport. Respect logical positioning for Arabic RTL and English LTR; in English choose a deliberately consistent LTR sidebar placement according to existing shell UX, not a CSS accident. Keep current search semantics and controls, allow intentional nav grouping only if all real links/permissions remain available.

At 768px, do not clip navigation as in historical 06.7 screenshots; use a keyboard-accessible collapsible drawer or properly discoverable overflow. At 390px, compact header + navigable drawer with close, Escape, focus return, scroll lock and active selection. Do not hide logout/language/theme if available. No unimplemented global search route.

## 5.3 Dashboard composition

Recommended visual sequence from TARGET_01:

1. Concise page title and context; optional subtle logistics accent (not decorative dominance).
2. 3–4 KPI cards **only for provable scoped metrics**, with units/labels faithful to source. If a card lacks an API metric, replace it with a real count or omit it; no mockup's `74`, `25`, fabricated shipment trends or completed percentages.
3. **Today's Actions**: visible task-centric rows with case reference, client (when permitted), actual next action, applicable due timestamp/priority; 5–8 top entries and a working link to actual full list. Never invent a task scheduling algorithm; use real API/source sorting and deadlines.
4. **Grouped alerts** with real reminder status, grouped carefully only for presentation; do not aggregate duplicate business cycles incorrectly, do not cause hidden urgent items. Grouping needs a reliable count/link and expandable accessible view.
5. **Upcoming dates** only for actual deadlines/timezone semantics; omit a date/relative label if absent.
6. **Documents lane** and **Cargo lane** in separate cards. Document send via courier != container or goods delivered. Progress charts ONLY if numerator/denominator and states are real, comparable, properly scoped and documented; otherwise use status summary lists instead of misleading donut charts.
7. **Recent activity** from an actual event/activity source if available. If only generic history exists, show grounded original event types; if no activity API exists, use a legitimate existing section or clearly defined empty/unsupported state, never invented events/actors/timestamps.

Prefer actionable operational clarity over mockup's exact numerical/text details. **Never use list filtering to expose global totals via restricted sessions.**

## 5.4 Export cases workspace composition

Recommended visual sequence from TARGET_02:

1. Title and subordinate explanation, optional compact KPIs from legitimate scoped source.
2. Filter/search bar wired to real existing `?q=` and existing filter parameters only. Sort/pagination must stay owned by actual server, including historical `updated_at` order; preserve browser query and back/forward. Do not add imaginary backend filters or 'all customers' dropdown if not available.
3. Desktop table at 1366+: meaningful columns prioritized by scannability: EF reference, customer (scoped), BANK/DIRECT, real next action, document status, cargo status, booking/UCR only when recorded, last updated, case state. Use actual current list API fields; not every suggested field is mandatory if it would cause N+1 or an API change. Reuse existing real data and disclose omitted fields.
4. `EF-...` and invoice/container/UCR strings isolate bidi rendering with existing LTR helpers, `<bdi>`-equivalent DOM handling and nonbreaking identifiers.
5. Case selection contextual panel: **only if safely implementable from existing case-detail endpoint with authorized reads** and if it does not leak restricted attachments/financial data or create N+1 per table row. Lazy-load one selected case, provide clear loading/error/403 states, close/deselect controls, URL/deep-link resilience. If excessive scope, implement a *lightweight* preview using existing row fields with a functional 'Open full case' action; mark richer panel as `DEFERRED` instead of inventing data.
6. Preserve full case detail route and all editors (document versions, invoice lock/correction, booking/container slots, bank/direct, reminders, public tracking, custom fields). The concept's mini tabs must not replace actual full case tabs or remove controls.
7. Mobile 390: readable card list, inline key status, next action and one unambiguous primary case-opening action; filters accessible in sheet/drawer. Tablet 768: adaptive dense list/cards or horizontal scroll INSIDE the table only with visible affordance; no whole-page horizontal overflow.
8. Loading, zero results, no authorization, partial data, error and destructive/permission denied states must look intentional. No fake optimistic 'success' for unconfirmed writes.

## 5.5 Arabic/English and type treatment

Use existing localization mechanism. Every new interactive string must have both AR and EN entries, no raw English fallback in normal Arabic state. Customer-entered free text is not automatically translated. Dates/times must respect current app behavior; do not alter Cairo reminder semantics. Numeric identifiers, ISO containers, UCR, invoice references, URLs keep LTR isolation and readable punctuation.

Typography: previous checkpoints reported OS Segoe fallback. A locally bundled properly licensed Arabic/Latin font is desirable but not mandatory if rights/compatibility cannot be proven. Compare candidates e.g. IBM Plex Sans Arabic / Noto Sans Arabic and Inter, validate OFL/license and subset glyphs if adding. Never retrieve proprietary font files from unauthorized sites or add remote font/CDN dependency without approval. Document real `document.fonts.check` or other safe runtime proof instead of claiming success from a CSS `font-family` name.

---

# 6. Implement as a controlled, reversible change — not a rewrite

**Allowed source edits:** existing app shell/topbar/sidebar/mobile nav; existing Dashboard; existing Cases index/list; small shared components (KPI card, action queue, status badge, table/card row, empty/error skeleton, contextual preview); targeted AR/EN dictionaries; Tailwind v4 tokens; local licensed assets if verified; E2E/visual test fixture hardening and screen-specific tests. Other screens may inherit harmless shared tokens but **may not be redesigned** in this checkpoint.

Implement in small reviewable increments:

### Phase 0 — Guard rails, root and fixture isolation
- Prove working directory, do not touch a different product, record current bundle SHA-256 and UI files baseline.
- Discover all potentially destructive test/build scripts and default Wrangler state fallbacks. Isolate first, run later.
- Capture immediate source screenshots with a **deterministic seeded dataset and exactly scoped admin/limited logins**; separate from and label historic 06.7 screenshot references.
- Record current before times using an apples-to-apples measurement method.

### Phase 1 — Shared tokens + shell
- Implement consistent `@theme` token use, high contrast, lightweight image policy and single-icon-library usage; do not replace current API layer.
- Recreate premium right sidebar/topbar, responsive drawer and keyboard semantics. Test 390/768/1366 plus 200% zoom navigation immediately.

### Phase 2 — Dashboard
- Implement real scoped metrics, action worklist, grouped alerts, deadlines and separate document/cargo panels with evidence-to-API mapping.
- Do not take liberty to calculate KPI percent changes if there is no historical comparison API.
- Ensure no 'activity' fiction, no courier/goods confusion and no hidden urgent events.

### Phase 3 — Cases
- Implement filter/search/table/card/responsive layout and optional contextual preview according to actual data contract; preserve existing case detail and route.
- No new bulk editing/deletion or mutation unless already present/authorized. New 'Create' button must route to actual existing case-create flow and appear only to permitted users.

### Phase 4 — Accessibility, RTL and responsive QA
- Validate keyboard nav, focus order, drawer Escape/return, color contrast, 200% zoom, touch targets, AR/EN screenshot parity, long client names, large counts, mixed-direction text and dates.
- Prove status text remains accessible and no key business state is communicated only by color, icon or donut.

### Phase 5 — Performance, security and functional regression
- Real authenticated ready-time measured for identical datasets (at least five warm measurements on before and after; document cold if feasible), plus JS/CSS/font/image sizes and request count.
- Avoid per-row detail API calls; document any added fetch and avoid loading giant list to calculate scoped KPIs in frontend.
- Re-run authorization, invoice correction, BANK/DIRECT, document upload, container/booking, reminder action, logout, public link tests. Do not change backend so existing tests pass artificially.

### Phase 6 — Evidence, report, STOP
- Regenerate final after screenshots from the final code **after last fix**; screenshots must correspond to final source and same dataset as immediate-before comparison. Review every final image visually, not just existence.
- Deliver Arabic final report and STOP. No 06.8, no cloud, no Git, no DB changes.

---

# 7. Strict visual-evidence and screenshot contract

## 7.1 Required 24-cell matrix before AND after

Capture `dashboard|cases` × `admin|limited` × `ar|en` × `390|768|1366` = **24 immediate BEFORE images and 24 final AFTER images** with matching names and identical deterministic fixtures. Screenshot filenames such as:

- `dashboard-admin-ar-1366.png`
- `dashboard-limited-en-390.png`
- `cases-admin-ar-768.png`
- `cases-limited-en-1366.png`

A filename existing is insufficient: validate browser has reached data-ready marker and loaded authorized API state, not a skeleton or stale fixture. Compare logged-in user, seed/dataset, timezone, viewport, locale, feature flags and environment in manifest.

For each cell record: `file, exact fixture id, local server build ref (hash), role, language, viewport, data_ready, visual_opened_reviewed, layout bugs, missing elements, console errors, screenshot_sha256`.

## 7.2 Additional states

Provide separate optional/evidence captures for: empty Dashboard, API failure on Dashboard, no-result case search, overdue/urgent group expanded, mobile drawer open/closed, tablet 768 navigation, limited-role forbidden control/action, cases contextual preview loading/error, long customer name/RTL mixed invoice, full case detail still operating. Capture only if routes/fixtures available legitimately; mark unavailable explicitly.

## 7.3 Target-to-implementation comparison

Create side-by-side contact sheets or clear tables for:

- Target A image vs final dashboard AR desktop screenshot.
- Target B image vs final cases AR desktop screenshot.
- Immediate-before vs final-after for admin AR 1366, admin AR 390, admin EN 768, limited-role AR desktop and mobile.

Report **per-region target fidelity** as `implemented | adapted for truth | unavailable | intentionally omitted` and why. The mockup's invented text/numbers cannot be counted as missing features. No attempt to use image similarity scores alone to certify real UX.

---

# 8. Explicit UI-to-domain correctness assertions

These assertions MUST appear in E2E or meaningful integration tests, or be documented as NOT_TESTED rather than falsely PASS:

1. BANK case shows bank-dependent document stages, DIRECT case does not create/require bank stages.
2. Courier document completion does not auto-set cargo delivery; port arrival does not auto-complete customer delivery.
3. Five planned container slots may show only two actual ISO container IDs; missing IDs display honest placeholders, never fake numbers.
4. Invoice total is shown from stored explicit field; no frontend FOB/CFR recomputation.
5. Completed invoice lock and exceptional correction permission/reason/audit remain enforced and visible through real case detail.
6. Admin and limited employee receive appropriately scoped dashboard totals and case rows **from backend**, not merely filtered JSX.
7. Limited user direct unauthorized API request remains HTTP 403 where policy requires (e.g. `/api/v1/users`), and unauthorized navigation/actions not rendered.
8. Real reminder due/once/snoozed/resolved semantics not reinterpreted when presenting Today's Actions and alerts. No invented CUSTOM_FOLLOWUP.
9. Public tracking continues to exclude money/private PDF; no addition to public payload.
10. Search/filter/sort/paging matches actual API contract; browser back/forward and deep links work.
11. Hono network errors/401/403/409 and loading states are represented honestly; no success-looking zeroes on failure.
12. Logout works with Better Auth cookie; no auth token in localStorage.
13. English LTR and Arabic RTL do not corrupt identifiers, ISO container values, document labels or financial display.
14. All newly introduced action buttons navigate or perform an existing authorized action; no decorative click targets.
15. No more than one icon library introduced and no uncontrolled navigation menu growth.

---

# 9. Test execution and objective acceptance gates

Use reproducible project commands determined from actual package scripts; report exact command, timestamp, exit status, environment, duration and artifacts. Previous checkpoint 06.7 reported **34/34 E2E twice and 31/31 unit**, but those are historical, not guaranteed current. Preserve or increase relevant coverage; tests with retries must disclose count.

**Mandatory:**

- TypeScript `tsc -b`, lint, Vitest, isolated build with publishable-dist secret guard.
- Dedicated source-isolation test ensuring neither build, code probes, old 'developer admin' probe nor Playwright touches `.wrangler/state` (main/WAL/SHM). A read-only SQLite open is still forbidden for tests.
- Playwright full suite **twice consecutively AFTER final code fix** with `retries=0`, independent process logs, zero unexpected `ECONNRESET`/`fetch failed` within observable denominator and no backend business regression. If denominator missing, report logs-only rather than invent a rate.
- Targeted screen tests for AR/EN, admin/limited scope, navigation/drawer keyboard, forms/actions, filter input, resulting case navigation, 401/403, empty/error states, BANK/DIRECT, completed case invoice lock, public redaction.
- Check mobile 390, tablet 768, desktop 1366, and 200% zoom; no clipped nav, text overlay, unusable table or global sideways page scrolling.
- Retain and **do not adjust** the local 320ms Workerd mitigation. Record extra UI requests/latency, do not mark transport root cause fixed.
- Compare screenshot and authenticated readiness before/after on SAME seeded dataset, timezone, role, viewport and warmup. At least N=5 comparable warm runs per Dashboard and Cases; document timing method, median and max, and do not invent p95 from small samples.
- Verify bundle sizes, font licensing/font loaded status, image weight, React console errors and network failures.

## Required acceptance gates

| Gate | Evidence required | FAIL/PARTIAL rules |
| --- | --- | --- |
| G00 | Root verified, scope/consent documented | Wrong repo = BLOCKED |
| G01 | Both PNG targets opened and SHA256-manifested | Missing image = BLOCKED |
| G02 | Source/read ledger and real contract matrix | Unknown fields cannot be fabricated |
| G03 | Test/build dev DB isolation proved | Any touch to developer SQLite/WAL/SHM = FAIL |
| G04 | No secret leaks, no cloud/Git | Any leak/remote change = FAIL |
| G05 | Frozen domain guard rails reflected in UI | Any domain semantic break = FAIL |
| G06 | Dashboard looks coherently derived from TARGET_01 | Need real reviewed screenshots |
| G07 | Cases looks coherently derived from TARGET_02 | Need real reviewed screenshots |
| G08 | New header/sidebar/RTL and mobile/tablet drawer | Clipping or inaccessible links = PARTIAL/FAIL |
| G09 | No fake KPIs, no fabricated chart percentages/activity | Fake production data = FAIL |
| G10 | Two independent document/cargo tracks | Conflated states = FAIL |
| G11 | Admin/limited data scope and direct 403 | UI-only hiding = FAIL |
| G12 | 24 matched BEFORE screenshot cells | Missing comparable data = PARTIAL |
| G13 | 24 matched AFTER screenshot cells reviewed | Missing/stale images = PARTIAL |
| G14 | Case full detail and Rule C preserved | Lock/correction regression = FAIL |
| G15 | BANK/DIRECT/manual DHL/container semantics preserved | Workflow rewrite = FAIL |
| G16 | UI controls/search/pagination/no dead buttons | Dead action = PARTIAL/FAIL |
| G17 | AR/EN, RTL/LTR, keyboard, zoom | Untested screen reader = NOT_TESTED |
| G18 | Local fonts/icon licensing and correct usage | Unlicensed asset = FAIL |
| G19 | Performance before/after apples-to-apples | Missing N=5 = PARTIAL |
| G20 | Unit/type/lint/build secret guard | Failed command = FAIL |
| G21 | Full E2E run 1 post-last-fix, retries=0 | Failure = FAIL |
| G22 | Full E2E run 2 post-last-fix, retries=0 | Failure = FAIL |
| G23 | No unintended edits to backend/schema/plan | Any unauthorized change = FAIL |
| G24 | Arabic final report + reliable evidence | Missing reports = PARTIAL |
| G25 | Owner visual signoff remains separate | Never mark approved on agent's judgment |

Final status is **PASS only if every mandatory implementable gate is proven**; otherwise `PARTIAL`, `BLOCKED`, or `FAIL` with explicit blockers. Never equate two green E2E runs with design or production approval.

---

# 10. Required deliverable file set

At minimum, write these verified real artifacts inside the project root (names may adapt if they would collide; document actual paths):

1. `docs/CHECKPOINT_06_7_1_SOURCE_AND_CONTRACT_LEDGER.md`
2. `docs/CHECKPOINT_06_7_1_VISUAL_REFERENCE_MAPPING.md`
3. `docs/CHECKPOINT_06_7_1_PREIMPLEMENTATION_AND_ROLLBACK.md`
4. `docs/CHECKPOINT_06_7_1_UI_ARCHITECTURE_AND_TOKENS.md`
5. `docs/CHECKPOINT_06_7_1_DOMAIN_INVARIANTS_AND_PERMISSION_MATRIX.md`
6. `docs/CHECKPOINT_06_7_1_TEST_DATA_AND_ISOLATION_PROOF.md`
7. `docs/CHECKPOINT_06_7_1_VISUAL_QA_AND_ACCESSIBILITY.md`
8. `docs/CHECKPOINT_06_7_1_PERFORMANCE_BEFORE_AFTER.md`
9. `docs/CHECKPOINT_06_7_1_CHANGE_AND_ROLLBACK_LEDGER.md`
10. `docs/CHECKPOINT_06_7_1_OPEN_RISKS_AND_OWNER_DECISIONS.md`
11. `docs/CHECKPOINT_06_7_1_FINAL_REPORT.md` — **comprehensive Arabic report**.
12. `docs/qa-screenshots/checkpoint-06-7-1/before/` and `/after/`, manifests, comparison contact sheets.
13. Source code/tests, limited to documented frontend and safe test harness changes.

**No release archive, tags or publication without separate authorization.** Do not create a new site/repo or move code to a separate UI stack. Current backend stays the truth.

---

# 11. Mandatory comprehensive Arabic final report — 60 sections

`docs/CHECKPOINT_06_7_1_FINAL_REPORT.md` MUST be entirely understandable to an Arabic-speaking project owner, preserve technical names accurately, give exact evidence paths/links and distinguish measured from prior and unverified. Include EACH numbered section:

01. Cover: checkpoint, date, verified root, execution actor/environment.
02. Executive outcome / actual change for the export employee.
03. Separate implementation, visual, security, performance, production statuses.
04. Authorization boundaries and actions explicitly NOT performed.
05. Product purpose and intended users, without inventing features.
06. Frozen commercial workflows and owner decisions preserved.
07. Actual technology/package versions vs assumed prior reports.
08. Exact image references, dimensions, provenance, SHA-256.
09. Target A visual description and scope.
10. Target B visual description and scope.
11. Legacy baseline screenshot source and limitations.
12. Current source inventory and data/permission path trace.
13. Developer DB isolation safeguard and forbidden-script remediation.
14. Developer DB/WAL/SHM observed metadata only, no unsupported unchanged claim.
15. Secrets/build/dist leak scan and isolated fixture provenance.
16. UI direction comparison, why this specific design chosen.
17. Target-to-component pixel/semantic interpretation table.
18. Explicit fabricated mockup content deliberately NOT copied.
19. Tailwind v4 token strategy and actual code references.
20. Color palette with precise values and contrast ratios.
21. Typography choice, actual licensing files and loading evidence.
22. One-icon-library policy and representative icons used.
23. App shell/sidebar/topbar after, for admin and limited.
24. Mobile/tablet drawer/Escape/focus/navigation 200% zoom.
25. Dashboard hierarchy and first-fold prioritization.
26. Dashboard KPIs: every number's endpoint + scope, no fabricated trend.
27. Today's Actions data source, ordering, deep links.
28. Alert grouping, snooze/once/due state semantics unchanged.
29. Deadlines and Cairo/calendar ambiguity unchanged.
30. Documents track: actual state and metric interpretation.
31. Cargo track: port arrival vs client delivery distinction.
32. Recent activity: real endpoint or honest omission.
33. Cases desktop table: field-level mapping.
34. Cases tablet and mobile layout.
35. Case search/filter/pagination/back-forward behavior.
36. Contextual preview: scope, query count, access controls, deferrals.
37. Existing full dossier preserved and linked.
38. BANK workflow UI proof.
39. DIRECT workflow UI proof.
40. Manual courier/DHL status proof, document != goods.
41. Bookings/optional UCR/container-slot honesty.
42. Completed invoice lock and authorized Rule C correction proof.
43. Customer snapshots/custom fields and display permission proof.
44. Public tracking redaction/permission regression evidence.
45. AR/EN keys, translation quality, bidi and numeric identifiers.
46. Accessibility keyboard/focus/touch/contrast/screen reader scope.
47. Empty/loading/zero results/API error and 401/403/409 UX.
48. Browser screenshots: 24 BEFORE manifest and reviewed images.
49. Browser screenshots: 24 AFTER manifest and reviewed images.
50. Detailed Target A vs final dashboard differences.
51. Detailed Target B vs final cases differences.
52. Apples-to-apples paired comparison and fixture parity proof.
53. Performance timings (warm N, median/max) before/after.
54. Assets/bundle/font/image weights and potential regressions.
55. Exact TypeScript/lint/unit commands, exit codes, warning analysis.
56. Playwright first full run metrics and transport failures.
57. Playwright second full run metrics and transport failures.
58. Defects found/fixed/remaining with priorities P0–P3.
59. Precise file-by-file change and rollback ledger; no Git changes.
60. Gate results, owner decisions/visual signoff pending, and STOP.

Required **comparison tables**, at least:

A. Functional scope and frozen contract map.
B. Target PNG region ↔ actual component/route map.
C. The reference-vs-implementation intentional differences.
D. Exact before/after file change and rollback table.
E. KPI field/API authorization/source table.
F. ADMIN vs LIMITED screen/data/API 403 matrix.
G. BANK vs DIRECT/document lane/goods lane matrix.
H. Invoice Rule C and completed-case permission matrix.
I. AR/EN × 390/768/1366 × admin/limited visual matrix (24 cells).
J. Keyboard/focus/contrast/zoom/accessibility matrix.
K. Performance request-count/latency/bundle metrics.
L. Full command+duration+exit/test cases ledger.
M. Security/data-isolation/secret guard ledger.
N. Defects/owners/severity/repro/evidence table.
O. Gate 00–25 pass/partial/blocked matrix.
P. Open inherited vs newly introduced risks and owner decisions.

## Mandatory final report footer (use measured truth, never hardcode PASS)

```
CHECKPOINT: 06.7.1
FINAL_STATUS: PASS|PARTIAL|BLOCKED|FAIL
PROJECT_ROOT: <verified>
REFERENCES_TARGET_A_OPENED: YES|NO
REFERENCES_TARGET_B_OPENED: YES|NO
VISUAL_DIRECTION: PREMIUM_OPERATIONS_WORKSPACE
BACKEND_API_CONTRACTS: UNCHANGED|CHANGED_UNAUTHORIZED|UNKNOWN
BUSINESS_RULES: VERIFIED_PRESERVED|PARTIAL|REGRESSED
PROJECT_ROADMAP: UNCHANGED|DEVIATION_REQUIRES_OWNER
DEVELOPER_DB_ISOLATION: PASS|PARTIAL|FAIL
DEVELOPER_DB_HISTORICAL_IDENTITY: UNVERIFIABLE_NO_PRIOR_HASH
CLOUD_STAGING: NOT_RUN
PRODUCTION: NOT_APPROVED
GIT: NOT_TOUCHED
OWNER_VISUAL_APPROVAL: PENDING
DASHBOARD_VISUAL_MATCH: PASS|PARTIAL|FAIL
CASES_VISUAL_MATCH: PASS|PARTIAL|FAIL
SCREENSHOTS_BEFORE: <n>/24
SCREENSHOTS_AFTER: <n>/24
RTL_AR_EN: PASS|PARTIAL|FAIL
AUTH_DATA_SCOPE: PASS|PARTIAL|FAIL
PERFORMANCE_PARITY: PASS|PARTIAL|NOT_MEASURED
UNIT_TESTS: <n>/<n>, exit=<code>
PLAYWRIGHT_RUN_1: <n>/<n>, exit=<code>, retries=<n>, transport_faults=<n>
PLAYWRIGHT_RUN_2: <n>/<n>, exit=<code>, retries=<n>, transport_faults=<n>
PUBLISHABLE_DIST_SECRETS: CLEAN|FAIL|NOT_VERIFIED
REMINDER_CRON_PREEXISTING_RISK: OPEN
WORKER_CONCURRENCY_PREEXISTING_RISK: OPEN
LOCAL_320MS_MITIGATION: RETAINED_LOCAL_ONLY
CUSTOM_FOLLOWUP: NOT_IMPLEMENTED_WITHOUT_OWNER_SPEC
NEXT_STAGE: OWNER_APPROVAL_REQUIRED
STOP
```

**Final imperative:** Do the work on the actual existing code in the confirmed project root, against real source truth and the two exact packaged visual PNGs. Do not merely describe an implementation; do not create a standalone HTML imitation; do not deliver new dummy pages; do not claim pass without evidence. **Reconstruct the look while preserving the logistics system's real logic and its development plan. After the Arabic final report, STOP.**
