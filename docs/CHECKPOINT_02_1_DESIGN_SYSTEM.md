# Checkpoint 02.1 design system

LOCAL ONLY. No new component library and no font CDN.

## Before

Authenticated before-screenshots were not captured. The UI files were already being edited when the dev server became runnable, and this workspace had no running app at the start. The defects below were read from the source that Checkpoint 02 shipped: one flat white card treatment, Google Fonts links in `index.html`, raw English inside Arabic mode, status text equal to database enums, and a public tracking page that shared no bilingual shell.

## Tokens

Defined in `src/index.css` under `@theme`:

| Token | Value | Use |
| --- | --- | --- |
| `--color-ink` | `#1a2332` | Text |
| `--color-ink-muted` | `#5c6b7c` | Secondary text |
| `--color-paper` | `#f3f1eb` | Canvas |
| `--color-card` | `#fffcf8` | Surfaces |
| `--color-line` | `#e4ddd2` | Dividers |
| `--color-accent` | `#0f6e6b` | Active progress |
| `--color-accent-2` | `#1b2838` | Sidebar |
| `--color-danger` | `#9f2d2d` | Problems |
| `--color-ok` | `#1f7a4d` | Completed |
| `--color-warn` | `#9a6700` | Pending |

Font stack: Segoe UI, Tahoma, Arial. These ship with Windows and cover Arabic. No font files were added. `prefers-reduced-motion` collapses animation. `:focus-visible` keeps a 2px accent outline.

## Primitives

| Piece | File | Role |
| --- | --- | --- |
| App shell | `src/app/shell.tsx` | Navy sidebar from `lg`, top search, language button `ع` / `EN`, mobile row plus an overlay drawer |
| PageHeader, SectionCard, StatCard, Ltr, EmptyState | `src/components/ui/chrome.tsx` | Page title, stats that link to real routes, `bdi dir=ltr` for identifiers |
| Button, Field, Input, Select | `src/components/ui/button.tsx`, `input.tsx` | Shared height, radius, and labels |
| StatusBadge | `src/components/ui/status.tsx` | Tone plus visible text. English uses the spaced code via `tx`; Arabic uses `status.*` |

## Screens

Login is a split navy panel and a card, with a password visibility toggle and a separate first-admin block. The dashboard reads `/api/v1/dashboard` only. Case detail has two tracks (documents versus goods) and tabs whose English labels stay lowercase so the existing tests match. Customers mask bank numbers. Invoices label the entered total and do not sum it. Documents keep the checklist statuses. Bank steps render only on the bank route. Courier copy says the source is manual. Bookings show planned versus actual dates and slot numbers. Public tracking has no app sidebar.

## Screenshots

`docs/qa-screenshots/checkpoint-02-1/`

- `en-login-1366.png`, `en-dashboard-1366.png`, `ar-dashboard-1366.png`, `ar-dashboard-390.png`
- `en-case-1366.png`, `ar-case-1366.png`, `ar-case-390.png`

Captured by Playwright `channel: "chrome"` during `e2e/visual.spec.ts` and `E2E-15`. Not generated images.

## Residual

Activity rows still show stored audit action codes. The bookings and containers tables scroll horizontally below about 720px rather than becoming cards. No calendar was added.
